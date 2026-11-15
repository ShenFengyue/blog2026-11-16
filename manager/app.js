// 写作界面：列表 / 编辑 / 预览 / 自动保存 / 删除 / 发布
const $ = (id) => document.getElementById(id);
const state = { posts: [], current: null, dirty: false, filter: 'all', dialogMode: 'new', timer: null };

const api = async (path, body) => {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json', 'x-manager': '1' } : { 'x-manager': '1' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({ error: '响应解析失败' }));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
};

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), ms);
}

/* ---------- 预览用极简 markdown ---------- */

function mdToHtml(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const inline = (t) => {
    let s = escHtml(t);
    s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) => `<img src="${u}" alt="${a}">`);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t2, u) => `<a href="${u}">${t2}</a>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return s;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line.trim())) {
      i++;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++]);
      i++;
      out.push(`<pre>${escHtml(buf.join('\n'))}</pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
      continue;
    }
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      const items = [];
      const ordered = /^\s*\d+\./.test(line);
      while (i < lines.length && /^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>\s?|\s*(?:[-*+]|\d+\.)\s+|(-{3,}|\*{3,}|_{3,})$)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) { buf.push(lines[i]); i++; }
    out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  return out.join('\n');
}

/* ---------- 渲染 ---------- */

function countWords() {
  const body = $('body').value;
  return body.replace(/\s/g, '').length;
}

function renderPreview() {
  const body = $('body').value;
  const title = $('title').value.trim();
  const chars = countWords();
  $('words').textContent = `${chars} 字 · 约 ${Math.max(1, Math.round(chars / 350))} 分钟`;
  $('pv-meta').textContent = title ? `${Math.max(1, Math.round(chars / 350))} 分钟` : '';
  const head = title ? `<h1>${escHtml(title)}</h1>` : '';
  const meta = $('date').value ? `<div style="font-size:11.5px;color:var(--muted);margin-bottom:14px">${escHtml($('date').value)}</div>` : '';
  if (!title && !body.trim()) {
    $('pv-body').innerHTML = '<p class="pv-empty">还没有内容。</p>';
    return;
  }
  $('pv-body').innerHTML = head + meta + mdToHtml(body);
}

function renderList() {
  const kw = $('q').value.trim().toLowerCase();
  const items = state.posts.filter((p) => {
    if (state.filter === 'draft' && !p.draft) return false;
    if (state.filter === 'live' && p.draft) return false;
    return !kw || p.title.toLowerCase().includes(kw) || p.p.toLowerCase().includes(kw);
  });

  if (!items.length) {
    $('list').innerHTML = '<p style="padding:14px 10px;color:var(--muted);font-size:12.5px">没有匹配的文章。</p>';
    return;
  }

  const byYear = new Map();
  for (const p of items) {
    const y = p.date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(p);
  }

  $('list').innerHTML = [...byYear.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map(
      (y) => `<div class="y-label">${y}</div>${byYear
        .get(y)
        .map(
          (p) => `<div class="row${state.current && state.current.p === p.p ? ' on' : ''}" data-p="${escHtml(p.p)}">
  <div class="t">${escHtml(p.title)}${p.draft ? '<span class="badge">草稿</span>' : ''}</div>
  <div class="d">${p.date.slice(5)}</div>
  <button class="del" data-del="${escHtml(p.p)}" title="删除">×</button>
</div>`
        )
        .join('')}`
    )
    .join('');

  $('list').querySelectorAll('.row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.dataset.del) return;
      openPost(row.dataset.p);
    });
  });
  $('list').querySelectorAll('.del').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      askDelete(btn.dataset.del);
    });
  });
}

function setDirty(d) {
  state.dirty = d;
  $('save-state').textContent = d ? '未保存…' : state.current ? '已保存' : '未选择文章';
  $('save-state').style.color = d ? 'var(--warn)' : '';
  if (d) {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => save(true), 4000);
  }
}

/* ---------- 操作 ---------- */

async function loadPosts() {
  state.posts = await api('/api/posts');
  renderList();
}

async function openPost(p) {
  if (state.dirty) await save(true);
  const data = await api('/api/post?p=' + encodeURIComponent(p));
  state.current = { p };
  $('title').value = data.front.title || '';
  $('date').value = (data.front.date || '').toString().slice(0, 10);
  $('tags').value = (data.front.tags || []).join(', ');
  $('draft').checked = data.front.draft === true;
  $('body').value = data.body.replace(/^\n+/, '');
  $('path').textContent = p.split('/').pop().replace(/\.md$/, '');
  $('btn-del').disabled = false;
  $('btn-pub').disabled = false;
  setDirty(false);
  renderPreview();
  renderList();
  $('body').focus();
  $('body').setSelectionRange(0, 0);
}

function currentPayload() {
  return {
    p: state.current.p,
    title: $('title').value.trim(),
    date: $('date').value,
    tags: $('tags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    summary: '',
    draft: $('draft').checked,
    body: $('body').value
  };
}

async function save(silent) {
  if (!state.current) return;
  clearTimeout(state.timer);
  try {
    await api('/api/save', currentPayload());
    state.dirty = false;
    const t = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    $('save-state').textContent = `已保存 ${t}`;
    $('save-state').style.color = '';
    await loadPosts();
    refreshGit();
    if (!silent) toast('已保存到本地');
  } catch (e) {
    $('save-state').textContent = '保存失败';
    toast('保存失败：' + e.message, 4000);
  }
}

async function refreshGit() {
  try {
    const s = await api('/api/status');
    if (!s.repo) {
      $('dot').classList.add('bad');
      $('repo-text').textContent = '未连接仓库';
      $('git-state').textContent = '';
      return;
    }
    $('dot').classList.remove('bad');
    $('repo-text').textContent = 'shenblog.vercel.app';
    $('git-state').textContent = s.changed ? `${s.changed} 个改动未发布` : '工作区干净';
  } catch {
    $('dot').classList.add('bad');
    $('repo-text').textContent = '状态读取失败';
  }
}

async function publish() {
  if (!state.current) return;
  $('btn-pub').disabled = true;
  $('btn-pub').textContent = '发布中…';
  try {
    if (state.dirty) await save(true);
    const r = await api('/api/publish', { message: `post: ${$('title').value.trim()}` });
    if (r.ok) {
      toast(r.note || '已推送，Vercel 正在构建', 3600);
      $('git-state').textContent = '已推送';
    } else {
      const bad = r.steps.find((s) => !s.ok);
      toast(`发布中断：${bad ? bad.name + ' · ' + String(bad.detail).slice(0, 90) : '未知原因'}`, 6000);
    }
    refreshGit();
  } catch (e) {
    toast('发布失败：' + e.message, 5000);
  } finally {
    $('btn-pub').disabled = false;
    $('btn-pub').textContent = '发布到 GitHub';
  }
}

function openDialog(mode, title, desc, value, okText, danger) {
  state.dialogMode = mode;
  $('dlg-title').textContent = title;
  $('dlg-desc').textContent = desc;
  $('dlg-input').value = value || '';
  $('dlg-input').style.display = mode === 'confirm' ? 'none' : '';
  const ok = $('dlg-ok');
  ok.textContent = okText;
  ok.className = danger ? 'ghost danger' : 'primary';
  ok.style.background = danger ? 'var(--danger)' : '';
  ok.style.color = danger ? '#fff' : '';
  $('mask').classList.add('on');
  if (mode !== 'confirm') $('dlg-input').focus();
}

function closeDialog() {
  $('mask').classList.remove('on');
}

function askDelete(p) {
  const post = state.posts.find((x) => x.p === p);
  openDialog('delete', '删除这篇文章？', `${post ? post.title : p}\n文件会从本地删除，下次发布会同步到线上。`, p, '删除', true);
}

async function doDialog() {
  if (state.dialogMode === 'new') {
    const title = $('dlg-input').value.trim();
    if (!title) return;
    const r = await api('/api/new', { title });
    closeDialog();
    await loadPosts();
    await openPost(r.p);
    toast('已创建草稿');
    return;
  }
  if (state.dialogMode === 'delete') {
    const p = $('dlg-input').value;
    await api('/api/delete', { p });
    closeDialog();
    if (state.current && state.current.p === p) {
      state.current = null;
      state.dirty = false;
      $('title').value = '';
      $('body').value = '';
      $('date').value = '';
      $('tags').value = '';
      $('path').textContent = '';
      $('draft').checked = false;
      $('btn-del').disabled = true;
      $('btn-pub').disabled = true;
      $('save-state').textContent = '未选择文章';
      $('words').textContent = '0 字';
      $('pv-body').innerHTML = '<p class="pv-empty">选择或新建一篇文章。</p>';
    }
    await loadPosts();
    refreshGit();
    toast('已删除。点「发布到 GitHub」同步到线上', 3200);
  }
}

/* ---------- 工具条 ---------- */

function surround(before, after) {
  const ta = $('body');
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || '文字';
  ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
  ta.focus();
  ta.setSelectionRange(s + before.length, s + before.length + sel.length);
  setDirty(true);
  renderPreview();
}

function linePrefix(prefix) {
  const ta = $('body');
  const s = ta.selectionStart;
  const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
  ta.value = ta.value.slice(0, lineStart) + prefix + ta.value.slice(lineStart);
  ta.focus();
  ta.setSelectionRange(s + prefix.length, s + prefix.length);
  setDirty(true);
  renderPreview();
}

function insertText(text) {
  const ta = $('body');
  const s = ta.selectionStart;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(s);
  ta.focus();
  ta.setSelectionRange(s + text.length, s + text.length);
  setDirty(true);
  renderPreview();
}

const actions = {
  h2: () => linePrefix('## '),
  h3: () => linePrefix('### '),
  bold: () => surround('**', '**'),
  italic: () => surround('*', '*'),
  code: () => surround('`', '`'),
  quote: () => linePrefix('> '),
  ul: () => linePrefix('- '),
  hr: () => insertText('\n\n---\n\n'),
  link: () => surround('[', '](https://)'),
  image: () => insertText('\n\n![](/uploads/)\n\n')
};

/* ---------- 事件 ---------- */

const markDirty = () => {
  setDirty(true);
  renderPreview();
};
['title', 'date', 'tags', 'body'].forEach((id) => $(id).addEventListener('input', markDirty));
$('draft').addEventListener('change', markDirty);
$('q').addEventListener('input', renderList);
$('btn-refresh').onclick = async () => {
  await loadPosts();
  refreshGit();
};
$('btn-new').onclick = () => openDialog('new', '新建文章', '文件名会自动带上今天的日期，标题之后还能改。', '', '创建');
$('btn-del').onclick = () => state.current && askDelete(state.current.p);
$('btn-pub').onclick = publish;
$('dlg-cancel').onclick = closeDialog;
$('dlg-ok').onclick = doDialog;
$('dlg-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doDialog();
});
$('mask').addEventListener('click', (e) => {
  if (e.target.id === 'mask') closeDialog();
});
$('btn-pv').onclick = () => {
  const off = $('main').classList.toggle('no-pv');
  localStorage.setItem('pv-off', off ? '1' : '0');
  $('btn-pv').style.color = off ? 'var(--faint)' : '';
};
document.querySelectorAll('.filters .chip').forEach((c) => {
  c.onclick = () => {
    document.querySelectorAll('.filters .chip').forEach((x) => x.classList.remove('on'));
    c.classList.add('on');
    state.filter = c.dataset.f;
    renderList();
  };
});
document.querySelectorAll('.tools .tb').forEach((b) => {
  b.onclick = () => actions[b.dataset.md]();
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
  if (e.key === 'Escape' && $('mask').classList.contains('on')) closeDialog();
});

/* 图片粘贴 / 拖入 */
async function uploadImage(file) {
  const data = await new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(file);
  });
  const r = await api('/api/upload', { name: file.name, data });
  insertText(`\n\n![](${r.url})\n\n`);
  toast('图片已插入');
}
$('body').addEventListener('paste', async (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  await uploadImage(item.getAsFile());
});
$('body').addEventListener('dragover', (e) => e.preventDefault());
$('body').addEventListener('drop', async (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file || !file.type.startsWith('image/')) return;
  e.preventDefault();
  await uploadImage(file);
});

if (localStorage.getItem('pv-off') === '1') {
  $('main').classList.add('no-pv');
  $('btn-pv').style.color = 'var(--faint)';
}

/* 点在空白处也能继续写 */
document.querySelector('.doc').addEventListener('click', (e) => {
  if (e.target.classList.contains('doc') || e.target.classList.contains('col')) {
    const ta = $('body');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
});

setDirty(false);
loadPosts()
  .then(refreshGit)
  .catch((e) => {
    $('repo-text').textContent = '无法连接本地服务';
    toast('无法连接本地服务：' + e.message, 5000);
  });
