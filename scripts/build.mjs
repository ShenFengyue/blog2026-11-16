// 静态站点生成器（零依赖）：content/posts/**.md → dist/
import { readdir, readFile, writeFile, mkdir, rm, cp, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.dirname(import.meta.dirname);
const CONTENT = path.join(ROOT, 'content');
const DIST = path.join(ROOT, 'dist');
const PUBLIC = path.join(ROOT, 'public');

const site = JSON.parse(await readFile(path.join(ROOT, 'site.json'), 'utf8'));

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
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) => `<img src="${u}" alt="${a}" loading="lazy">`);
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
  posts.push({
    slug,
    title: data.title || slug,
    date: (data.date || s.mtime.toISOString().slice(0, 10)).toString().slice(0, 10),
    updated: (data.updated || data.date || '').toString().slice(0, 10),
    tags: Array.isArray(data.tags) ? data.tags : [],
    summary: data.summary || '',
    draft: data.draft === true,
    body,
    minutes: Math.max(1, Math.round(plain(body).length / 350))
  });
}

posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));

const published = posts.filter((p) => !p.draft);
const groups = new Map();
for (const p of published) {
  const y = p.date.slice(0, 4);
  if (!groups.has(y)) groups.set(y, []);
  groups.get(y).push(p);
}
const years = [...groups.keys()].sort((a, b) => b.localeCompare(a));

const excerpt = (p) => p.summary || plain(p.body).slice(0, 90);

/* ---------------- 页面骨架 ---------------- */

const sidebar = (active) => `
<aside class="sidebar" id="sidebar">
  <div class="side-title">全部文章 · ${published.length}</div>
  ${years
    .map(
      (y) => `
  <div class="group">
    <button class="group-head" type="button"><span class="chev">▾</span>${y}</button>
    <ul class="items">
      ${groups
        .get(y)
        .map(
          (p) =>
            `<li><a class="item${p.slug === active ? ' active' : ''}" href="/posts/${encodeURIComponent(p.slug)}/">${esc(p.title)}</a></li>`
        )
        .join('\n      ')}
    </ul>
  </div>`
    )
    .join('\n')}
</aside>`;

const shell = ({ title, description = '', body, active = '', toc = '', prefix = '' }) => `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<link rel="stylesheet" href="/style.css">
<link rel="alternate" type="application/rss+xml" title="${esc(site.title)} · RSS" href="/feed.xml">
</head>
<body>
<header class="topbar">
  <a class="brand" href="/"><span class="logo">${esc(site.author || site.title.slice(0, 1))}</span>${esc(site.title)}</a>
  <a class="search" href="/search/"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>搜索文章…<span class="kbd">Ctrl K</span></a>
  <div class="top-actions">
    <button class="icon-btn" id="theme" type="button" title="切换主题"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg></button>
  </div>
</header>
<div class="layout">
${sidebar(active)}
<main>${body}</main>
${toc ? `<aside class="toc"><div class="toc-title">本页目录</div>${toc}</aside>` : '<aside class="toc"></aside>'}
</div>
<script src="/main.js"></script>
</body>
</html>`;

/* ---------------- 首页 ---------------- */

const indexBody = `
<div class="doc">
  <div class="hero">
    <h1>${esc(site.title)}</h1>
    <p class="tagline">${esc(site.tagline || '')}</p>
  </div>
  ${years
    .map(
      (y) => `
  <section class="year">
    <div class="year-label">${y}<span>${groups.get(y).length} 篇</span></div>
    ${groups
      .get(y)
      .map(
        (p) => `
    <a class="entry" href="/posts/${encodeURIComponent(p.slug)}/">
      <div class="entry-title">${esc(p.title)}</div>
      <div class="entry-meta">${p.date} · ${p.minutes} 分钟${p.tags.length ? ' · ' + p.tags.map(esc).join(' / ') : ''}</div>
      <div class="entry-sum">${esc(excerpt(p))}</div>
    </a>`
      )
      .join('\n')}
  </section>`
    )
    .join('\n')}
  <p class="foot-note">共 ${published.length} 篇 · <a href="/archive/">归档</a> · <a href="/tags/">标签</a> · <a href="/about/">关于</a> · <a href="/feed.xml">RSS</a></p>
</div>`;

/* ---------------- 文章页 ---------------- */

const renderPost = (p, idx) => {
  const { html, headings } = renderMarkdown(p.body);
  const newer = published[idx - 1];
  const older = published[idx + 1];
  const toc = headings
    .filter((h) => h.level === 2 || h.level === 3)
    .map((h) => `<a href="#${h.id}">${esc(h.text)}</a>`)
    .join('');

  const body = `
<article class="doc">
  <div class="crumbs"><a href="/">博客</a><span class="sep">/</span>${p.date.slice(0, 4)}<span class="sep">/</span>${esc(p.title)}</div>
  <h1>${esc(p.title)}</h1>
  <div class="meta">
    <time datetime="${p.date}">${p.date}</time>
    <span>约 ${p.minutes} 分钟</span>
    ${p.tags.map((t) => `<a class="tag" href="/tags/#${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}
    ${p.draft ? '<span class="draft-flag">草稿</span>' : ''}
  </div>
  <div class="content">${html}</div>
  <nav class="pager">
    ${newer ? `<a class="card" href="/posts/${encodeURIComponent(newer.slug)}/"><div class="dir">← 上一篇</div><div class="t">${esc(newer.title)}</div></a>` : '<span></span>'}
    ${older ? `<a class="card next" href="/posts/${encodeURIComponent(older.slug)}/"><div class="dir">下一篇 →</div><div class="t">${esc(older.title)}</div></a>` : '<span></span>'}
  </nav>
</article>`;

  return shell({
    title: `${p.title} · ${site.title}`,
    description: excerpt(p),
    body,
    active: p.slug,
    toc
  });
};

/* ---------------- 归档 / 标签 / 搜索 / 关于 / 404 ---------------- */

const archiveBody = `
<div class="doc">
  <div class="crumbs"><a href="/">博客</a><span class="sep">/</span>归档</div>
  <h1>归档</h1>
  <p class="lead">共 ${published.length} 篇。</p>
  ${years
    .map(
      (y) => `
  <div class="year-label">${y}<span>${groups.get(y).length} 篇</span></div>
  <ul class="archive">
    ${groups
      .get(y)
      .map(
        (p) =>
          `<li><a href="/posts/${encodeURIComponent(p.slug)}/"><time>${p.date.slice(5)}</time><span>${esc(p.title)}</span></a></li>`
      )
      .join('\n    ')}
  </ul>`
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
      ${list.map((p) => `<li><a href="/posts/${encodeURIComponent(p.slug)}/"><time>${p.date}</time><span>${esc(p.title)}</span></a></li>`).join('\n      ')}
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

const notFoundBody = `
<div class="doc">
  <h1>页面不存在</h1>
  <p class="lead">这条链接可能已经变了。去 <a href="/">首页</a> 或 <a href="/archive/">归档</a> 找找。</p>
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
    published.map((p) => ({ t: p.title, u: `/posts/${encodeURIComponent(p.slug)}/`, d: p.date, x: plain(p.body).slice(0, 2000) })),
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
    (p) => `<item><title>${esc(p.title)}</title><link>${base}/posts/${encodeURIComponent(p.slug)}/</link><guid>${base}/posts/${encodeURIComponent(p.slug)}/</guid><pubDate>${new Date(p.date).toUTCString()}</pubDate><description>${esc(excerpt(p))}</description></item>`
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
${published.map((p) => `<url><loc>${base}/posts/${encodeURIComponent(p.slug)}/</loc><lastmod>${p.updated || p.date}</lastmod></url>`).join('\n')}
</urlset>`
);

await cp(PUBLIC, DIST, { recursive: true });

console.log(`构建完成：${published.length} 篇文章 → dist/`);
