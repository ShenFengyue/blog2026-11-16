// 本地管理器：只在 127.0.0.1 上跑，写文章 / 传图片 / 改站点信息 → 自动同步到 GitHub
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, stat, mkdir, unlink, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const CONTENT = path.join(ROOT, 'content', 'posts');
const PAGE_DIR = path.join(ROOT, 'content');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DIST_DIR = path.join(ROOT, 'dist');
const SITE_FILE = path.join(ROOT, 'site.json');
const THEME_KEYS = ['classic', 'a', 'b', 'c', 'd'];
const PORT = Number(process.env.PORT || 5178);

// 固定页：不是文章，但云端有这一页，本地也要能改
const PAGES = {
  about: { file: 'about.md', label: '关于我', path: '/about/' },
  nf: { file: '404.md', label: '404 页', path: '/404.html' }
};

/* ---------- 工具 ---------- */

const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

const parseFront = (raw0) => {
  const raw = String(raw0).replace(/\r\n/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!mm) continue;
    let v = mm[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else if (/^["'].*["']$/.test(v)) v = v.slice(1, -1);
    else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    data[mm[1]] = v;
  }
  return { data, body: raw.slice(m[0].length) };
};

// 本机日期（UTC+8），不用 toISOString 的 UTC，避免凌晨写成前一天
const today = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

const normDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : '');
const normTime = (t) => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const hh = Math.min(23, Number(m[1]));
  const mm = Math.min(59, Number(m[2]));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

const buildFile = ({ title, date, time, tags, summary, body }) => {
  const lines = ['---', `title: ${JSON.stringify(title || '')}`, `date: ${date}`];
  if (time) lines.push(`time: ${time}`);
  lines.push(`updated: ${today()}`, `tags: [${(tags || []).filter(Boolean).join(', ')}]`);
  if (summary) lines.push(`summary: ${JSON.stringify(summary)}`);
  lines.push('---', '', String(body || '').trim(), '');
  return lines.join('\n');
};

const safeName = (t) => t.replace(/[\\/:*?"<>|]/g, '').replace(/[“”]/g, '').replace(/\s+/g, ' ').trim();

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

const exists = (p) => stat(p).then(() => true, () => false);

const git = (args) =>
  new Promise((resolve) => {
    execFile('git', args, { cwd: ROOT, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim() })
    );
  });

const node = (args) =>
  new Promise((resolve) => {
    execFile(process.execPath, args, { cwd: ROOT, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim() })
    );
  });

/* ---------- 自动提交推送（图片、站点信息） ---------- */
// 合并 1.2 秒内的多次改动，一次提交一次推送，避免连续粘贴几张图产生一串 commit

const queue = { paths: new Set(), msg: '', waiters: [], timer: null, running: false };

function flushQueue() {
  clearTimeout(queue.timer);
  queue.timer = null;
  if (queue.running) {
    queue.timer = setTimeout(flushQueue, 1200);
    return;
  }
  if (!queue.paths.size) return;
  queue.running = true;
  const paths = [...queue.paths];
  const msg = queue.msg || 'assets: 更新图片';
  const waiters = queue.waiters.splice(0);
  queue.paths.clear();
  queue.msg = '';
  pushPaths(paths, msg).then((r) => {
    queue.running = false;
    waiters.forEach((w) => w.resolve(r));
    if (queue.paths.size) queue.timer = setTimeout(flushQueue, 1200);
  });
}

async function pushPaths(paths, message) {
  const inRepo = await git(['rev-parse', '--is-inside-work-tree']);
  if (!inRepo.ok) return { ok: false, committed: false, pushed: false, detail: '这个文件夹还不是 git 仓库' };

  const changed = await git(['status', '--porcelain', '--', ...paths]);
  if (!changed.out) return { ok: true, committed: false, pushed: false, detail: '没有变化' };

  const add = await git(['add', '--', ...paths]);
  if (!add.ok) return { ok: false, committed: false, pushed: false, detail: add.out };

  // 只提交这几个路径，不碰正在改的文章
  const commit = await git(['commit', '-m', message, '--', ...paths]);
  if (!commit.ok) {
    const hint = /Author identity unknown|Please tell me who you are/i.test(commit.out)
      ? '还没设置 git 用户名/邮箱：git config --global user.name "名字" / user.email "邮箱"'
      : commit.out;
    return { ok: false, committed: false, pushed: false, detail: hint };
  }

  const push = await git(['push']);
  if (!push.ok) {
    const hint = /No configured push destination|does not appear to be a git repository|Could not read from remote/i.test(push.out)
      ? '还没配置/连不上远程仓库，已在本地提交，等发布会一起推'
      : push.out.split('\n').slice(-1)[0];
    return { ok: true, committed: true, pushed: false, detail: hint };
  }
  return { ok: true, committed: true, pushed: true, detail: '已同步 GitHub' };
}

function queuePush(relPaths, message) {
  for (const p of relPaths) queue.paths.add(p.replace(/\\/g, '/'));
  queue.msg = message;
  return new Promise((resolve) => {
    queue.waiters.push({ resolve });
    clearTimeout(queue.timer);
    queue.timer = setTimeout(flushQueue, 1200);
  });
}

/* ---------- 站点信息 ---------- */

async function readSite() {
  const raw = await readFile(SITE_FILE, 'utf8');
  return JSON.parse(raw);
}

async function saveSite(patch) {
  const cur = await readSite();
  const next = {
    title: String(patch.title ?? cur.title ?? '').trim().slice(0, 60) || '我的博客',
    tagline: String(patch.tagline ?? cur.tagline ?? '').trim().slice(0, 200),
    author: String(patch.author ?? cur.author ?? '').trim().slice(0, 20),
    description: String(patch.description ?? cur.description ?? '').trim().slice(0, 300),
    theme: THEME_KEYS.includes(String(patch.theme ?? cur.theme ?? 'classic').toLowerCase())
      ? String(patch.theme ?? cur.theme ?? 'classic').toLowerCase()
      : 'classic',
    url: String(patch.url ?? cur.url ?? '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
  };
  next.url = next.url ? `https://${next.url}` : '';
  if (!next.author) next.author = next.title.slice(0, 1);
  const text = JSON.stringify(next, null, 2) + '\n';
  await writeFile(SITE_FILE, text, 'utf8');
  const build = await node(['scripts/build.mjs']);
  const sync = await queuePush(['site.json'], `site: 更新站点信息「${next.title}」`);
  return { ok: true, site: next, built: build.ok, buildOut: build.ok ? '' : build.out, sync };
}

// 只切版式：本地重建，不提交不推送（想上线再点「保存并同步」）
async function switchTheme(theme) {
  const t = String(theme || '').toLowerCase();
  if (!THEME_KEYS.includes(t)) throw new Error('未知版式');
  const cur = await readSite();
  cur.theme = t;
  await writeFile(SITE_FILE, JSON.stringify(cur, null, 2) + '\n', 'utf8');
  const build = await node(['scripts/build.mjs']);
  return { ok: true, theme: t, site: cur, built: build.ok, out: build.ok ? '' : build.out.slice(-300) };
}

/* ---------- 文章 ---------- */

async function listPosts() {
  const files = await walk(CONTENT);
  const items = [];
  const dirtyRaw = (await git(['status', '--porcelain', '-z'])).out;
  for (const f of files) {
    const raw = await readFile(f, 'utf8');
    const { data } = parseFront(raw);
    const s = await stat(f);
    const rel = path.relative(CONTENT, f).replace(/\\/g, '/');
    const mtimeDay = new Date(s.mtime.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    items.push({
      p: rel,
      title: data.title || path.basename(f, '.md'),
      date: (data.date || mtimeDay).toString().slice(0, 10),
      time: normTime(data.time),
      changed: dirtyRaw.includes(`content/posts/${rel}`),
      mtime: s.mtimeMs
    });
  }
  const key = (p) => `${p.date} ${p.time || '00:00'}`;
  return items.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) return ka < kb ? 1 : -1;
    return a.title.localeCompare(b.title, 'zh-CN');
  });
}

async function status() {
  const inRepo = await git(['rev-parse', '--is-inside-work-tree']);
  if (!inRepo.ok) return { repo: false, hint: '这个文件夹还不是 git 仓库，先运行「首次上传到 GitHub.bat」' };
  const branch = await git(['branch', '--show-current']);
  const remote = await git(['remote', 'get-url', 'origin']);
  const dirty = await git(['status', '--porcelain']);
  const changed = dirty.out ? dirty.out.split('\n').filter(Boolean).length : 0;
  return {
    repo: true,
    branch: branch.out || '(未命名分支)',
    remote: remote.ok ? remote.out : '',
    changed
  };
}

// 改日期时把文件挪进对应年份目录；文件名（地址）保持不动，旧链接不会失效
async function relocate(full, date) {
  const dir = path.join(CONTENT, date.slice(0, 4));
  let target = path.join(dir, path.basename(full));
  if (path.resolve(full) === path.resolve(target)) return full;
  await mkdir(dir, { recursive: true });
  let n = 2;
  while (await exists(target)) target = path.join(dir, `${path.basename(full, '.md')}-${n++}.md`);
  await rename(full, target);
  return target;
}

async function savePost({ p, title, date, time, tags, summary, body }) {
  const full = path.join(CONTENT, decodeURIComponent(p));
  if (!path.resolve(full).startsWith(path.resolve(CONTENT))) throw new Error('路径不合法');
  const d = normDate(date) || today();
  const t = normTime(time);
  await writeFile(full, buildFile({ title, date: d, time: t, tags, summary, body }), 'utf8');
  const moved = await relocate(full, d);
  const rel = path.relative(CONTENT, moved).replace(/\\/g, '/');
  return { ok: true, p: rel, date: d, time: t };
}

async function newPost({ title, date, time }) {
  const d = normDate(date) || today();
  const t = normTime(time);
  const slug = `${d}-${safeName(title) || '未命名'}`;
  const dir = path.join(CONTENT, d.slice(0, 4));
  await mkdir(dir, { recursive: true });
  let file = path.join(dir, `${slug}.md`);
  let n = 2;
  while (await exists(file)) file = path.join(dir, `${slug}-${n++}.md`);
  await writeFile(file, buildFile({ title: title || '未命名', date: d, time: t, tags: [], summary: '', body: '' }), 'utf8');
  return { ok: true, p: path.relative(CONTENT, file).replace(/\\/g, '/') };
}

async function deletePost({ p }) {
  const full = path.join(CONTENT, decodeURIComponent(p));
  if (!path.resolve(full).startsWith(path.resolve(CONTENT))) throw new Error('路径不合法');
  if (!full.toLowerCase().endsWith('.md')) throw new Error('只能删除 .md');
  await unlink(full);
  return { ok: true, p };
}

/* ---------- 固定页（关于我 / 404） ---------- */

const PAGE_FALLBACK = {
  about: { title: '关于我', body: '在这里写点关于自己的事。' },
  nf: {
    title: '页面不存在',
    body: '这条链接可能已经变了。去 [首页](/) 或 [归档](/archive/) 找找。'
  }
};

async function readPage(key) {
  const meta = PAGES[key];
  if (!meta) throw new Error('未知页面');
  const full = path.join(PAGE_DIR, meta.file);
  const raw = await readFile(full, 'utf8').catch(() => null);
  const { data, body } = raw ? parseFront(raw) : { data: {}, body: '' };
  const fb = PAGE_FALLBACK[key] || { title: meta.label, body: '' };
  return {
    key,
    label: meta.label,
    path: meta.path,
    title: data.title || fb.title,
    body: String(body || '').replace(/^\n+/, '').replace(/\s+$/, '') || (raw ? '' : fb.body),
    exists: !!raw
  };
}

async function savePage({ key, title, body }) {
  const meta = PAGES[key];
  if (!meta) throw new Error('未知页面');
  const full = path.join(PAGE_DIR, meta.file);
  if (!path.resolve(full).startsWith(path.resolve(PAGE_DIR))) throw new Error('路径不合法');
  const t = String(title || meta.label).trim() || meta.label;
  const text = ['---', `title: ${JSON.stringify(t)}`, '---', '', String(body || '').trim(), ''].join('\n');
  await writeFile(full, text, 'utf8');
  const build = await node(['scripts/build.mjs']);
  return { ok: true, key, title: t, built: build.ok, out: build.ok ? '' : build.out.slice(-300) };
}

async function publish({ message }) {
  const steps = [];
  const build = await node(['scripts/build.mjs']);
  steps.push({ name: '本地构建校验', ok: build.ok, detail: build.out.split('\n').slice(-2).join(' ') });
  if (!build.ok) return { ok: false, steps };

  const add = await git(['add', '-A']);
  steps.push({ name: 'git add', ok: add.ok, detail: add.out });
  if (!add.ok) return { ok: false, steps };

  const staged = await git(['diff', '--cached', '--name-only']);
  if (!staged.out) {
    steps.push({ name: 'git commit', ok: true, detail: '没有需要提交的改动' });
    return { ok: true, steps, note: '没有改动，未推送' };
  }

  const commit = await git(['commit', '-m', message || 'post: 更新']);
  steps.push({ name: 'git commit', ok: commit.ok, detail: commit.out.split('\n')[0] });
  if (!commit.ok) {
    const hint = /Author identity unknown|Please tell me who you are/i.test(commit.out)
      ? '还没设置 git 用户名/邮箱：git config --global user.name "名字" / user.email "邮箱"'
      : commit.out;
    return { ok: false, steps: steps.map((s) => (s.name === 'git commit' ? { ...s, detail: hint } : s)) };
  }

  const push = await git(['push']);
  steps.push({ name: 'git push', ok: push.ok, detail: push.out.split('\n').slice(-1)[0] });
  if (!push.ok) {
    const hint = /No configured push destination|does not appear to be a git repository/i.test(push.out)
      ? '还没配置远程仓库：git remote add origin https://github.com/你的用户名/仓库名.git'
      : push.out;
    return { ok: false, steps: steps.map((s) => (s.name === 'git push' ? { ...s, detail: hint } : s)) };
  }

  return { ok: true, steps, note: '已推送。Vercel 会在 30–60 秒内自动重新部署。' };
}

/* ---------- 图片 ---------- */

const MAX_BYTES = 12 * 1024 * 1024;
const SHRINK_THRESHOLD = 1200 * 1024;

const mimeExt = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp'
};

// 超过 1600 宽或体积偏大时，用系统自带的 System.Drawing 压一下；失败就用原图，不影响插入
async function shrink(buf, ext) {
  const src = path.join(os.tmpdir(), `blog-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);
  const out = path.join(os.tmpdir(), `blog-${Date.now()}-${Math.random().toString(16).slice(2)}-s.${ext}`);
  try {
    await writeFile(src, buf);
    const ps = path.join(ROOT, 'scripts', 'shrink-image.ps1');
    const r = await new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps, '-In', src, '-Out', out, '-MaxWidth', '1600'],
        { windowsHide: true, timeout: 20000 },
        (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim() })
      );
    });
    if (!r.ok || !(await exists(out))) return buf;
    const small = await readFile(out);
    return small.length < buf.length * 0.92 ? small : buf;
  } catch {
    return buf;
  } finally {
    unlink(src).catch(() => {});
    unlink(out).catch(() => {});
  }
}

async function upload({ data }) {
  const m = String(data || '').match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is);
  if (!m) throw new Error('只接受图片');
  const mime = m[1].toLowerCase();
  let ext = mimeExt[mime];
  if (!ext) throw new Error(`暂不支持这种图片格式：${mime}`);
  let buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new Error('图片内容为空');
  if (buf.length > MAX_BYTES) throw new Error('图片超过 12MB，请先压一下再粘贴');

  if ((ext === 'png' || ext === 'jpg') && buf.length > SHRINK_THRESHOLD) {
    buf = await shrink(buf, ext);
  }

  const ym = today().slice(0, 7);
  const hash = createHash('sha1').update(buf).digest('hex').slice(0, 10);
  const relDir = path.join('public', 'uploads', ym);
  const relFile = path.join(relDir, `${hash}.${ext}`);
  const full = path.join(ROOT, relFile);
  await mkdir(path.dirname(full), { recursive: true });
  const fresh = !(await exists(full));
  if (fresh) await writeFile(full, buf);

  // 新图片立刻提交并推送，GitHub / Vercel 那边随时可用，不必等发文
  const sync = fresh
    ? await queuePush([relFile], `assets: 新增图片 ${ym}/${hash}.${ext}`)
    : { ok: true, committed: false, pushed: false, detail: '图片已存在' };

  return { ok: true, url: `/uploads/${ym}/${hash}.${ext}`, size: buf.length, sync };
}

/* ---------- 服务器 ---------- */

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 40 * 1024 * 1024) reject(new Error('请求体过大'));
      else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });

const isLocalOrigin = (req) => {
  const origin = req.headers.origin || '';
  if (!origin) return true; // 本地直接请求可能没有 Origin
  return /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
};

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

// 管理器里预览要显示 /uploads 的图，顺便把 public 下的其它静态文件也放出去
async function servePublic(urlPath, res) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const full = path.join(PUBLIC_DIR, rel);
  if (!path.resolve(full).startsWith(path.resolve(PUBLIC_DIR))) {
    json(res, 403, { error: '路径不合法' });
    return;
  }
  const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
  try {
    const s = await stat(full);
    if (!s.isFile()) throw new Error('not file');
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', 'content-length': s.size });
    createReadStream(full).pipe(res);
  } catch {
    json(res, 404, { error: '文件不存在' });
  }
}

// 本地预览：把 dist 以 /site/ 前缀放出来（HTML 里的绝对链接临时改写，只影响预览）
async function serveDist(urlPath, res) {
  let rel = decodeURIComponent(urlPath.replace(/^\/site/, ''));
  if (!rel || rel === '/') rel = '/index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.join(DIST_DIR, rel);
  if (!path.resolve(full).startsWith(path.resolve(DIST_DIR))) {
    json(res, 403, { error: '路径不合法' });
    return;
  }
  const s = await stat(full).catch(() => null);
  if (!s || !s.isFile()) {
    json(res, 404, { error: '还没构建过，先在管理器里点一次版式或发布' });
    return;
  }
  const ext = path.extname(full).toLowerCase();
  if (ext === '.html') {
    const html = (await readFile(full, 'utf8')).replace(/(href|src)="\//g, '$1="/site/');
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' }).end(html);
    return;
  }
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache', 'content-length': s.size });
  createReadStream(full).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/app.js')) {
      const file = url.pathname === '/' ? 'index.html' : 'app.js';
      const type = file === 'app.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
      const content = await readFile(path.join(import.meta.dirname, file));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(content);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) return servePublic(url.pathname, res);
    if (req.method === 'GET' && url.pathname === '/style.css') return servePublic(url.pathname, res);
    if (req.method === 'GET' && (url.pathname === '/site' || url.pathname.startsWith('/site/'))) {
      return serveDist(url.pathname, res);
    }

    if (req.method === 'GET' && url.pathname === '/api/posts') return json(res, 200, await listPosts());
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, await status());
    if (req.method === 'GET' && url.pathname === '/api/site') return json(res, 200, await readSite());
    if (req.method === 'GET' && url.pathname === '/api/page') {
      return json(res, 200, await readPage(url.searchParams.get('key') || ''));
    }

    if (req.method === 'GET' && url.pathname === '/api/post') {
      const full = path.join(CONTENT, decodeURIComponent(url.searchParams.get('p') || ''));
      if (!path.resolve(full).startsWith(path.resolve(CONTENT))) return json(res, 400, { error: '路径不合法' });
      const raw = await readFile(full, 'utf8');
      const { data, body } = parseFront(raw);
      return json(res, 200, { p: url.searchParams.get('p'), front: data, body });
    }

    if (req.method === 'POST') {
      if (req.headers['x-manager'] !== '1' || !isLocalOrigin(req)) return json(res, 403, { error: '拒绝非本地请求' });
      const payload = await readBody(req);
      if (url.pathname === '/api/save') return json(res, 200, await savePost(payload));
      if (url.pathname === '/api/save-page') return json(res, 200, await savePage(payload));
      if (url.pathname === '/api/new') return json(res, 200, await newPost(payload));
      if (url.pathname === '/api/delete') return json(res, 200, await deletePost(payload));
      if (url.pathname === '/api/publish') return json(res, 200, await publish(payload));
      if (url.pathname === '/api/upload') return json(res, 200, await upload(payload));
      if (url.pathname === '/api/settings') return json(res, 200, await saveSite(payload));
      if (url.pathname === '/api/theme') return json(res, 200, await switchTheme(payload.theme));
      return json(res, 404, { error: '接口不存在' });
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // 已经有一个管理器在跑，直接把窗口打开就行
    if (process.env.OPEN_BROWSER === '1') {
      execFile('cmd', ['/c', 'start', '', `http://127.0.0.1:${PORT}`], () => {});
    }
    setTimeout(() => process.exit(0), 1200);
    return;
  }
  console.error(err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  博客管理器已启动：http://127.0.0.1:${PORT}\n  仓库目录：${ROOT}\n  按 Ctrl+C 退出\n`);
  if (process.env.OPEN_BROWSER === '1') {
    execFile('cmd', ['/c', 'start', '', `http://127.0.0.1:${PORT}`], () => {});
  }
});
