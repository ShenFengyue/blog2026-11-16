// 静态站点生成器（零依赖）：content/posts/**.md → dist/
import { readdir, readFile, writeFile, mkdir, rm, cp, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.dirname(import.meta.dirname);
const CONTENT = path.join(ROOT, 'content');
const DIST = path.join(ROOT, 'dist');
const PUBLIC = path.join(ROOT, 'public');

const site = JSON.parse(await readFile(path.join(ROOT, 'site.json'), 'utf8'));

/* ---------------- 版式 ---------------- */
// site.json 里的 theme 决定用哪套版式；管理器右上角的齿轮 → 站点信息 里可以一键切换
const THEME_KEYS = ['classic', 'a', 'b', 'c', 'd'];
const THEME = THEME_KEYS.includes(String(site.theme || '').toLowerCase())
  ? String(site.theme).toLowerCase()
  : 'classic';
const SHEET = THEME === 'classic' ? '/style.css' : `/themes/${THEME}.css`;
const NAV_LINKS = [
  ['/archive/', '归档'],
  ['/tags/', '标签'],
  ['/about/', '关于'],
  ['/search/', '搜索'],
  ['/feed.xml', 'RSS']
];
const navHTML = NAV_LINKS.map(([u, t]) => `<a href="${u}">${t}</a>`).join('');

/* ---------------- 解析 ---------------- */

function parseFront(raw0) {
  const raw = String(raw0).replace(/\r\n/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!mm) continue;
    let v = mm[2].trim();
    if (/^\[.*\]$/.test(v)) {
      v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if (/^["'].*["']$/.test(v)) {
      v = v.slice(1, -1);
    } else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    data[mm[1]] = v;
  }
  return { data, body: raw.slice(m[0].length) };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(src) {
  let s = esc(src);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) => `<img src="${u}" alt="${a}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s;
}

const BLOCK_START = /^(#{1,6}\s|```|>|(?:[-*+]|\d+\.)\s+|(-{3,}|\*{3,}|_{3,})$)/;

function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const headings = [];
  let h = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim();
      i++;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++]);
      i++;
      out.push(
        `<pre><div class="code-head"><span>${esc(lang || 'text')}</span><button class="copy" type="button">复制</button></div><code>${esc(buf.join('\n'))}</code></pre>`
      );
      continue;
    }

    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      const lvl = hm[1].length;
      const text = hm[2].trim();
      if (lvl >= 2 && lvl <= 3) {
        h += 1;
        const id = `s${h}`;
        headings.push({ level: lvl, id, text });
        out.push(`<h${lvl} id="${id}">${inline(text)}</h${lvl}>`);
      } else {
        out.push(`<h${lvl}>${inline(text)}</h${lvl}>`);
      }
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { out.push('<hr>'); i++; continue; }

    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''));
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
      continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) { buf.push(lines[i]); i++; }
    out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  return { html: out.join('\n'), headings };
}

const plain = (md) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* ---------------- 读取文章 ---------------- */

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(full)));
    else if (e.name.toLowerCase().endsWith('.md')) files.push(full);
  }
  return files;
}

const posts = [];
for (const file of await walk(path.join(CONTENT, 'posts'))) {
  const raw = await readFile(file, 'utf8');
  const { data, body } = parseFront(raw);
  const slug = path.basename(file, '.md');
  const s = await stat(file);
  const localMtime = new Date(s.mtime.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  posts.push({
    slug,
    title: data.title || slug,
    date: (data.date || localMtime).toString().slice(0, 10),
    // 同一天发布多篇时用可选的 time（HH:MM）决定先后；不写就按文件名排
    time: /^\d{1,2}:\d{2}$/.test((data.time || '').toString().trim()) ? (data.time + '').trim().padStart(5, '0') : '',
    updated: (data.updated || data.date || localMtime).toString().slice(0, 10),
    tags: Array.isArray(data.tags) ? data.tags : [],
    summary: data.summary || '',
    body,
    minutes: Math.max(1, Math.round(plain(body).length / 350))
  });
}

// 时间倒序：date → time → slug
const stamp = (p) => `${p.date} ${p.time || '00:00'}`;
posts.sort((a, b) => {
  const ka = stamp(a);
  const kb = stamp(b);
  if (ka !== kb) return ka < kb ? 1 : -1;
  return a.slug.localeCompare(b.slug);
});

const published = posts;

// 年份 → 月份 → 文章。只收录真正有文章的月份，空月份不出现；
// 每次构建都重新计算，所以后来补进某个空月份的文章会立刻显示出来。
const tree = [];
const yearsMap = new Map();
for (const p of published) {
  const y = p.date.slice(0, 4);
  const m = p.date.slice(5, 7);
  if (!yearsMap.has(y)) yearsMap.set(y, new Map());
  const ms = yearsMap.get(y);
  if (!ms.has(m)) ms.set(m, []);
  ms.get(m).push(p);
}
for (const y of [...yearsMap.keys()].sort((a, b) => b.localeCompare(a))) {
  const ms = yearsMap.get(y);
  const months = [...ms.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((m) => ({ key: `${y}-${m}`, label: `${Number(m)}月`, posts: ms.get(m) }));
  tree.push({ y, months, total: months.reduce((n, x) => n + x.posts.length, 0) });
}

const excerpt = (p) => p.summary || plain(p.body).slice(0, 90);
const postURL = (p) => `/posts/${encodeURIComponent(p.slug)}/`;
const YEARS = tree.map((t) => t.y);
const SPAN = `${YEARS[YEARS.length - 1]} — ${YEARS[0]}`;

/* ---------------- 页面骨架 ---------------- */

// classic 版式的侧栏（年 → 月两级，可折叠）
const sidebar = (active) => `
<aside class="sidebar" id="sidebar">
  <div class="side-title">全部文章 · ${published.length}</div>
  ${tree
    .map(
      (t) => `
  <div class="group year-group" data-g="${t.y}">
    <button class="group-head" type="button"><span class="chev">▾</span>${t.y}<span class="cnt">${t.total}</span></button>
    <div class="month-list">
      ${t.months
        .map(
          (mm) => `
      <div class="group month-group" data-g="${mm.key}">
        <button class="group-head month-head" type="button"><span class="chev">▾</span>${mm.label}<span class="cnt">${mm.posts.length}</span></button>
        <ul class="items">
          ${mm.posts.map((p) => `<li><a class="item${p.slug === active ? ' active' : ''}" href="${postURL(p)}">${esc(p.title)}</a></li>`).join('\n          ')}
        </ul>
      </div>`
        )
        .join('\n')}
    </div>
  </div>`
    )
    .join('\n')}
</aside>`;

// C 版式的左栏：整面墙刻痕
const rail = () => `
<nav class="rail">
  <a class="brand" href="/">${esc(site.title)}</a>
  <div class="where">${esc(site.author || '')} · ${published.length} 篇</div>
  <div class="rail-nav">${navHTML}</div>
  ${tree
    .map(
      (t) => `<div class="ry">${t.y}</div>${t.months
        .map(
          (mm) => `<div class="rm">${mm.label}</div>${mm.posts
            .map((p) => `<a class="rp" href="${postURL(p)}">${esc(p.title)}</a>`)
            .join('')}`
        )
        .join('')}`
    )
    .join('')}
</nav>`;

const head = ({ title, description = '' }) => `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<link rel="stylesheet" href="${SHEET}">
<link rel="alternate" type="application/rss+xml" title="${esc(site.title)} · RSS" href="/feed.xml">
</head>`;

const shell = ({ title, description = '', body, active = '', toc = '' }) => {
  const h = head({ title, description });

  if (THEME === 'classic') {
    return `${h}<body>
<div class="progress" id="progress"></div>
<header class="topbar">
  <a class="brand" href="/"><span class="logo">${esc(site.author || site.title.slice(0, 1))}</span>${esc(site.title)}</a>
  <a class="search" href="/search/"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>搜索文章…<span class="kbd">Ctrl K</span></a>
  <div class="top-actions">
    <button class="icon-btn nav-btn" id="navbtn" type="button" title="文章目录"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01"/></svg></button>
    <button class="icon-btn" id="theme" type="button" title="切换主题"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg></button>
  </div>
</header>
<div class="layout">
${sidebar(active)}
<main>${body}</main>
${toc ? `<aside class="toc"><div class="toc-title">本页目录</div>${toc}</aside>` : ''}
</div>
<script src="/main.js"></script>
</body>
</html>`;
  }

  if (THEME === 'c') {
    return `${h}<body>
<div class="shell">
  <div class="railcol">${rail()}</div>
  <div class="main">
    <div class="wrap mast"><span class="stamp">${SPAN}</span><nav class="nav">${navHTML}</nav></div>
    ${body}
  </div>
</div>
<script src="/main.js"></script>
</body>
</html>`;
  }

  return `${h}<body>
<header class="top"><div class="wrap top-in">
  <a class="brand" href="/">${esc(site.title)}</a>
  <nav class="nav">${navHTML}</nav>
</div></header>
<main>${body}</main>
<script src="/main.js"></script>
</body>
</html>`;
};

/* ---------------- 首页 ---------------- */

const entryClassic = (p) => `
    <a class="entry" href="${postURL(p)}">
      <div class="entry-title">${esc(p.title)}</div>
      <div class="entry-meta">${p.date} · ${p.minutes} 分钟${p.tags.length ? ' · ' + p.tags.map(esc).join(' / ') : ''}</div>
      <div class="entry-sum">${esc(excerpt(p))}</div>
    </a>`;

const indexClassic = `
<div class="doc">
  <div class="hero">
    <h1>${esc(site.title)}</h1>
    <p class="tagline">${esc(site.tagline || '')}</p>
  </div>
  ${tree
    .map(
      (t) => `
  <section class="year">
    <div class="year-label">${t.y}<span>${t.total} 篇</span></div>
    ${t.months
      .map(
        (mm) => `
    <div class="month-label">${mm.label}<span>${mm.posts.length} 篇</span></div>
    ${mm.posts.map(entryClassic).join('\n')}`
      )
      .join('\n')}
  </section>`
    )
    .join('\n')}
  <p class="foot-note">共 ${published.length} 篇 · <a href="/archive/">归档</a> · <a href="/tags/">标签</a> · <a href="/about/">关于</a> · <a href="/feed.xml">RSS</a></p>
</div>`;

// A 廊：一条长廊，年份是柱、月份是刻度、文章是窗洞
const indexA = `
<section class="wrap hero">
  <div><h1>${esc(site.title)}</h1><p class="tagline">${esc(site.tagline || '')}</p></div>
  <div class="hero-side">${published.length} 篇<br>${SPAN}<br>${esc(site.author || '')}</div>
</section>
<div class="wrap">
${tree
  .map(
    (t) => `<section class="year">
  <div class="year-head"><span class="y">${t.y}</span><span class="count">${t.total} 篇 · ${t.months.length} 个月</span></div>
  ${t.months
    .map(
      (mm) => `<div class="month-label">${mm.label}</div>${mm.posts
        .map(
          (p) => `<a class="row" href="${postURL(p)}">
    <span class="date">${p.date.slice(5).replace('-', '.')}</span>
    <span class="title">${esc(p.title)}</span>
    <span class="sum">${esc(excerpt(p))}</span>
  </a>`
        )
        .join('')}`
    )
    .join('')}
</section>`
  )
  .join('')}
</div>
<div class="wrap"><footer class="foot"><span>© ${esc(site.author || '')}</span><span>${esc(site.url || '')}</span></footer></div>`;

// B 水庭：大留白 + 一条水面带承载最近三篇 + 两栏年份
const latest3 = published.slice(0, 3);
const indexB = `
<section class="wrap hero"><h1>${esc(site.title)}</h1><p class="tagline">${esc(site.tagline || '')}</p></section>
<section class="water"><div class="wrap water-in">
  <div class="lab">最近 · RECENT</div>
  <div class="stones">${latest3
    .map((p) => `<a class="stone" href="${postURL(p)}"><div class="t">${esc(p.title)}</div><div class="d">${p.date}</div></a>`)
    .join('')}</div>
</div></section>
<div class="wrap"><div class="archive2">
${tree
  .map(
    (t) => `<div class="yblock">
  <div class="y">${t.y}</div>
  <div class="cnt">${t.total} POSTS · ${t.months.length} MONTHS</div>
  ${t.months
    .map(
      (mm) => `<div class="m">${mm.label}</div>${mm.posts
        .map((p) => `<a class="entry" href="${postURL(p)}"><div class="t">${esc(p.title)}</div><div class="d">${p.date}</div></a>`)
        .join('')}`
    )
    .join('')}
</div>`
  )
  .join('')}
</div></div>
<div class="wrap"><footer class="foot"><span>${esc(site.author || '')} · ${esc(site.tagline || '')}</span><span>${SPAN}</span></footer></div>`;

// C 红土墙：左栏刻痕，主区放大字
const indexC = `
<div class="wrap">
  <section class="hero"><h1>${esc(site.title)}</h1><p class="tag">${esc(site.tagline || '')}</p><div class="wire"></div></section>
  ${tree
    .map(
      (t) => t.months
        .map(
          (mm) => `<div class="mlab">${t.y} · ${mm.label}</div>${mm.posts
            .map(
              (p) => `<a class="mrow" href="${postURL(p)}"><div><div class="t">${esc(p.title)}</div><div class="s">${esc(excerpt(p))}</div></div><div class="d">${p.date.slice(5).replace('-', '.')}</div></a>`
            )
            .join('')}`
        )
        .join('')
    )
    .join('')}
  <footer class="foot"><span>${esc(site.author || '')}</span><span>${SPAN}</span></footer>
</div>`;

// D 格栅：12 列障子，每格一篇文章
const indexD = `
<section class="wrap intro"><div><h1>${esc(site.title)}</h1><p class="tag">${esc(site.tagline || '')}</p></div>
<div class="legend">${published.length} 篇 · ${tree.length} 年 · 12 列格栅<br>移开鼠标看全貌，指向一格看细节</div></section>
<div class="grid" id="grid">
${tree
  .map((t) => {
    const cells = t.months
      .map((mm) =>
        mm.posts
          .map((p) => `<a class="cell" href="${postURL(p)}"><span class="d">${p.date.slice(5).replace('-', '.')}</span><span class="t">${esc(p.title)}</span></a>`)
          .join('')
      )
      .join('');
    const pad = (12 - (t.total % 12)) % 12;
    return `<div class="yband"><span class="y">${t.y}</span><span class="c">${t.total} POSTS</span></div>${cells}${'<span class="cell blank"></span>'.repeat(pad)}`;
  })
  .join('')}
</div>
<div class="wrap"><footer class="foot"><span>${esc(site.author || '')}</span><span>${SPAN}</span></footer></div>`;

const indexBody =
  THEME === 'a' ? indexA : THEME === 'b' ? indexB : THEME === 'c' ? indexC : THEME === 'd' ? indexD : indexClassic;

/* ---------------- 文章页 ---------------- */

const crumbsFor = (p) =>
  `<div class="crumbs"><a href="/">博客</a><span class="sep">/</span>${p.date.slice(0, 4)}<span class="sep">/</span>${esc(p.title)}</div>`;

const metaFor = (p) =>
  `<div class="meta"><time datetime="${p.date}">${p.date}</time><span>约 ${p.minutes} 分钟</span>${
    p.tags.length ? p.tags.map((t) => `<a class="tag" href="/tags/#${encodeURIComponent(t)}">${esc(t)}</a>`).join('') : '<span class="dim">未分类</span>'
  }</div>`;

const pagerFor = (newer, older) =>
  `<nav class="pager">${
    newer ? `<a class="card" href="${postURL(newer)}"><div class="dir">← 上一篇</div><div class="t">${esc(newer.title)}</div></a>` : '<span></span>'
  }${
    older ? `<a class="card next" href="${postURL(older)}"><div class="dir">下一篇 →</div><div class="t">${esc(older.title)}</div></a>` : '<span></span>'
  }</nav>`;

const renderPost = (p, idx) => {
  const { html, headings } = renderMarkdown(p.body);
  const newer = published[idx - 1];
  const older = published[idx + 1];
  const toc = headings
    .filter((h) => h.level === 2 || h.level === 3)
    .map((h) => `<a href="#${h.id}">${esc(h.text)}</a>`)
    .join('');

  let body = '';
  let tocAside = toc;

  if (THEME === 'a') {
    tocAside = '';
    body = `
<div class="wrap post-wrap"><div class="pgrid">
  <aside class="rail">${toc ? `<div class="lab">目录</div>${toc}` : '<div class="lab">目录</div><span class="empty">本文没有小节</span>'}<a class="back" href="/archive/">← 全部文章</a></aside>
  <article class="article">
    <div class="crumbs">${p.date.slice(0, 4)} / ${Number(p.date.slice(5, 7))}月</div>
    <h1>${esc(p.title)}</h1>
    ${metaFor(p)}
    <div class="content">${html}</div>
    ${pagerFor(newer, older)}
  </article>
</div></div>`;
  } else if (THEME === 'b') {
    tocAside = '';
    body = `
<div class="wrap post"><div class="post-in">
  <div class="vprog" id="vprog"><i></i></div>
  <div class="crumbs">${p.date.slice(0, 4)} · ${Number(p.date.slice(5, 7))}月</div>
  <h1>${esc(p.title)}</h1>
  ${metaFor(p)}
  <div class="content">${html}</div>
  ${pagerFor(newer, older)}
</div></div>`;
  } else if (THEME === 'c') {
    tocAside = '';
    body = `
<div class="postgrid">
  <div></div>
  <article class="post">
    <div class="crumbs">${p.date.slice(0, 4)} · ${Number(p.date.slice(5, 7))}月</div>
    <h1>${esc(p.title)}</h1>
    ${metaFor(p)}
    <div class="content">${html}</div>
    ${pagerFor(newer, older)}
  </article>
  <aside class="toc"><div class="toc-title">目录</div>${toc || '<span class="empty">本文没有小节</span>'}<a class="back" href="/archive/">← 全部文章</a></aside>
</div>`;
  } else if (THEME === 'd') {
    tocAside = '';
    body = `
<article class="post">
  <div class="crumbs">${p.date.slice(0, 4)} · ${Number(p.date.slice(5, 7))}月</div>
  <h1>${esc(p.title)}</h1>
  ${metaFor(p)}
  <div class="content">${html}</div>
  ${pagerFor(newer, older)}
</article>`;
  } else {
    body = `
<article class="doc">
  ${crumbsFor(p)}
  <h1>${esc(p.title)}</h1>
  ${metaFor(p)}
  <div class="content">${html}</div>
  ${pagerFor(newer, older)}
</article>`;
  }

  return shell({
    title: `${p.title} · ${site.title}`,
    description: excerpt(p),
    body,
    active: p.slug,
    toc: tocAside
  });
};

/* ---------------- 归档 / 标签 / 搜索 / 关于 / 404 ---------------- */

const archiveBody = `
<div class="doc">
  <div class="crumbs"><a href="/">博客</a><span class="sep">/</span>归档</div>
  <h1>归档</h1>
  <p class="lead">共 ${published.length} 篇。</p>
  ${tree
    .map(
      (t) => `
  <div class="year-label">${t.y}<span>${t.total} 篇</span></div>
  ${t.months
    .map(
      (mm) => `
  <div class="month-label">${mm.label}<span>${mm.posts.length} 篇</span></div>
  <ul class="archive">
    ${mm.posts
      .map((p) => `<li><a href="${postURL(p)}"><time datetime="${p.date}">${p.date.slice(8)}</time><span>${esc(p.title)}</span></a></li>`)
      .join('\n    ')}
  </ul>`
    )
    .join('\n')}`
    )
    .join('\n')}
</div>`;

const tagMap = new Map();
for (const p of published) for (const t of p.tags) {
  if (!tagMap.has(t)) tagMap.set(t, []);
  tagMap.get(t).push(p);
}
const tagList = [...tagMap.entries()].sort((a, b) => b[1].length - a[1].length);

const tagsBody = `
<div class="doc">
  <div class="crumbs"><a href="/">博客</a><span class="sep">/</span>标签</div>
  <h1>标签</h1>
  ${
    tagList.length
      ? tagList
          .map(
            ([t, list]) => `
  <section class="tag-block" id="${encodeURIComponent(t)}">
    <div class="year-label">${esc(t)}<span>${list.length} 篇</span></div>
    <ul class="archive">
      ${list.map((p) => `<li><a href="${postURL(p)}"><time>${p.date}</time><span>${esc(p.title)}</span></a></li>`).join('\n      ')}
    </ul>
  </section>`
          )
          .join('\n')
      : '<p class="lead">还没有标签。在文章 front matter 里写 <code>tags: [随想]</code> 就会出现在这里。</p>'
  }
</div>`;

const searchBody = `
<div class="doc">
  <div class="crumbs"><a href="/">博客</a><span class="sep">/</span>搜索</div>
  <h1>搜索</h1>
  <input class="big-input" id="q" type="search" placeholder="输入关键词，例如 贵人、远山、Git" autofocus>
  <div id="results" class="results"></div>
</div>`;

const aboutRaw = await readFile(path.join(CONTENT, 'about.md'), 'utf8').catch(() => null);
const about = aboutRaw ? parseFront(aboutRaw) : { data: { title: '关于' }, body: '' };
const aboutBody = `
<div class="doc">
  <div class="crumbs"><a href="/">博客</a><span class="sep">/</span>关于</div>
  <h1>${esc(about.data.title || '关于')}</h1>
  <div class="content">${renderMarkdown(about.body).html}</div>
  <p class="foot-note"><a href="/">← 回到首页</a></p>
</div>`;

// 404 页：正文来自 content/404.md，管理器里能改；没有这个文件就用默认文案
const nfRaw = await readFile(path.join(CONTENT, '404.md'), 'utf8').catch(() => null);
const nf = nfRaw
  ? parseFront(nfRaw)
  : { data: { title: '页面不存在' }, body: '这条链接可能已经变了。去 [首页](/) 或 [归档](/archive/) 找找。' };
const notFoundBody = `
<div class="doc">
  <h1>${esc(nf.data.title || '页面不存在')}</h1>
  <div class="content">${renderMarkdown(nf.body).html}</div>
</div>`;

/* ---------------- 写出 ---------------- */

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

const write = async (rel, content) => {
  const full = path.join(DIST, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
};

await write('index.html', shell({ title: site.title, description: site.description || site.tagline || '', body: indexBody }));
await write('archive/index.html', shell({ title: `归档 · ${site.title}`, description: `全部 ${published.length} 篇文章`, body: archiveBody }));
await write('tags/index.html', shell({ title: `标签 · ${site.title}`, body: tagsBody }));
await write('search/index.html', shell({ title: `搜索 · ${site.title}`, body: searchBody }));
await write('about/index.html', shell({ title: `${about.data.title || '关于'} · ${site.title}`, body: aboutBody }));
await write('404.html', shell({ title: `页面不存在 · ${site.title}`, body: notFoundBody }));

published.forEach((p, idx) => {
  write(`posts/${p.slug}/index.html`, renderPost(p, idx));
});

await write(
  'search.json',
  JSON.stringify(
    published.map((p) => ({ t: p.title, u: postURL(p), d: p.date, x: plain(p.body).slice(0, 2000) })),
    null,
    0
  )
);

const base = (site.url || 'https://example.vercel.app').replace(/\/$/, '');

await write(
  'feed.xml',
  `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${esc(site.title)}</title><link>${base}/</link><description>${esc(site.description || site.tagline || '')}</description><language>zh-cn</language>
${published
  .slice(0, 20)
  .map(
    (p) => `<item><title>${esc(p.title)}</title><link>${base}${postURL(p)}</link><guid>${base}${postURL(p)}</guid><pubDate>${new Date(p.date).toUTCString()}</pubDate><description>${esc(excerpt(p))}</description></item>`
  )
  .join('\n')}
</channel></rss>`
);

await write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${base}/</loc></url>
<url><loc>${base}/archive/</loc></url>
<url><loc>${base}/tags/</loc></url>
<url><loc>${base}/about/</loc></url>
${published.map((p) => `<url><loc>${base}${postURL(p)}</loc><lastmod>${p.updated || p.date}</lastmod></url>`).join('\n')}
</urlset>`
);

await cp(PUBLIC, DIST, { recursive: true });

console.log(`构建完成：${published.length} 篇文章 → dist/ · 版式 ${THEME}`);
