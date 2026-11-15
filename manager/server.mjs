// 本地管理器：只在 127.0.0.1 上跑，写文章 → 一键发布到 GitHub
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, stat, mkdir, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const CONTENT = path.join(ROOT, 'content', 'posts');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 5178);

/* ---------- 工具 ---------- */

const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

const parseFront = (raw) => {
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

const buildFile = ({ title, date, tags, summary, draft, body }) => {
  const lines = ['---', `title: ${JSON.stringify(title || '')}`, `date: ${date}`, `updated: ${new Date().toISOString().slice(0, 10)}`];
  const t = (tags || []).filter(Boolean);
  lines.push(`tags: [${t.join(', ')}]`);
  if (summary) lines.push(`summary: ${JSON.stringify(summary)}`);
  lines.push(`draft: ${draft ? 'true' : 'false'}`, '---', '', body.trim(), '');
  return lines.join('\n');
};

const safeName = (t) => t.replace(/[\\/:*?"<>|]/g, '').replace(/[“”]/g, '').replace(/\s+/g, ' ').trim();
const today = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

const git = (args, env = {}) =>
  new Promise((resolve) => {
    execFile('git', args, { cwd: ROOT, windowsHide: true, env: { ...process.env, ...env } }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim(), err: err ? err.code : 0 })
    );
  });

const node = (args) =>
  new Promise((resolve) => {
    execFile(process.execPath, args, { cwd: ROOT, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim() })
    );
  });

/* ---------- 接口 ---------- */

async function listPosts() {
  const files = await walk(CONTENT);
  const items = [];
  for (const f of files) {
    const raw = await readFile(f, 'utf8');
    const { data } = parseFront(raw);
    const s = await stat(f);
    items.push({
      p: path.relative(CONTENT, f).replace(/\\/g, '/'),
      title: data.title || path.basename(f, '.md'),
      date: (data.date || s.mtime.toISOString().slice(0, 10)).toString().slice(0, 10),
      draft: data.draft === true,
      mtime: s.mtimeMs
    });
  }
  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.title.localeCompare(a.title, 'zh-CN')));
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

async function savePost({ p, title, date, tags, summary, draft, body }) {
  const full = path.join(CONTENT, decodeURIComponent(p));
  if (!full.startsWith(CONTENT)) throw new Error('路径不合法');
  await writeFile(full, buildFile({ title, date, tags, summary, draft, body }), 'utf8');
  return { ok: true, p };
}

async function newPost({ title }) {  const d = today();
  const slug = `${d}-${safeName(title) || '未命名'}`;
  const dir = path.join(CONTENT, d.slice(0, 4));
  await mkdir(dir, { recursive: true });
  let file = path.join(dir, `${slug}.md`);
  let n = 2;
  while (await stat(file).then(() => true, () => false)) file = path.join(dir, `${slug}-${n++}.md`);
  await writeFile(file, buildFile({ title: title || '未命名', date: d, tags: [], summary: '', draft: true, body: '' }), 'utf8');
  return { ok: true, p: path.relative(CONTENT, file).replace(/\\/g, '/') };
}

async function deletePost({ p }) {
  const full = path.join(CONTENT, decodeURIComponent(p));
  if (!full.startsWith(CONTENT)) throw new Error('路径不合法');
  if (!full.toLowerCase().endsWith('.md')) throw new Error('只能删除 .md');
  await unlink(full);
  return { ok: true, p };
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

async function upload({ name, data }) {
  const m = String(data).match(/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/);
  if (!m) throw new Error('只接受图片');
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw new Error('图片超过 8MB');
  const ym = today().slice(0, 7);
  const hash = createHash('sha1').update(buf).digest('hex').slice(0, 10);
  const rel = path.join('uploads', ym, `${hash}.${ext}`);
  const full = path.join(PUBLIC_DIR, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf);
  return { ok: true, url: '/' + rel.replace(/\\/g, '/') };
}

/* ---------- 服务器 ---------- */

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 24 * 1024 * 1024) reject(new Error('请求体过大'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('JSON 解析失败'));
      }
    });
  });

const isLocalOrigin = (req) => {
  const origin = req.headers.origin || '';
  if (!origin) return true; // 本地直接请求可能没有 Origin
  return /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/app.js')) {
      const file = url.pathname === '/' ? 'index.html' : 'app.js';
      const type = file === 'app.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
      const content = await readFile(path.join(import.meta.dirname, file));
      res.writeHead(200, { 'content-type': type }).end(content);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/posts') return json(res, 200, await listPosts());
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, await status());

    if (req.method === 'GET' && url.pathname === '/api/post') {
      const full = path.join(CONTENT, decodeURIComponent(url.searchParams.get('p') || ''));
      if (!full.startsWith(CONTENT)) return json(res, 400, { error: '路径不合法' });
      const raw = await readFile(full, 'utf8');
      const { data, body } = parseFront(raw);
      return json(res, 200, { p: url.searchParams.get('p'), front: data, body });
    }

    if (req.method === 'POST') {
      if (req.headers['x-manager'] !== '1' || !isLocalOrigin(req)) return json(res, 403, { error: '拒绝非本地请求' });
      const payload = await readBody(req);
      if (url.pathname === '/api/save') return json(res, 200, await savePost(payload));
      if (url.pathname === '/api/new') return json(res, 200, await newPost(payload));
      if (url.pathname === '/api/delete') return json(res, 200, await deletePost(payload));
      if (url.pathname === '/api/publish') return json(res, 200, await publish(payload));
      if (url.pathname === '/api/upload') return json(res, 200, await upload(payload));
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
