// 写作界面：列表 / 编辑 / 预览 / 自动保存 / 删除 / 发布
const $ = (id) => document.getElementById(id);
const state = { posts: [], current: null, dirty: false, filter: 'all', mode: 'new', timer: null, saving: false };

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

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toast(msg, ms = 2400) {
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
    let s = esc(t);
    s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) => `<img src="${u}" alt="${a}">`);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t2, u) => `<a href="${u}" target="_blank" rel="noreferrer">${t2}</a>`);
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
      out.push(`<pre>${esc(buf.join('\n'))}</pre>`);
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

/* ---------- 状态显示 ---------- */

function setSave(kind, text) {
  const d = $('savedot');
  d.className = 'savedot' + (kind === 'dirty' ? ' dirty' : kind === 'err' ? ' err' : '');
  $('save-state').textContent = text;
}

function countWords() {
  return $('body').value.replace(/\s/g, '').length;
}

function renderPreview() {
  const body = $('body').value;
  const title = $('title').value.trim();
  const chars = countWords();
  const mins = Math.max(1, Math.round(chars / 350));
  $('words').textContent = chars ? `${chars} 字 · ${mins} 分钟` : '0 字';
  if (!title && !body.trim()) {
    $('pv-body').innerHTML = '<p class="pv-empty">还没有内容。</p>';
    return;
  }
  const head = title ? `<h1>${esc(title)}</h1>` : '';
  const meta = $('date').value ? `<div class="pvdate">${esc($('date').value)}</div>` : '';
  $('pv-body').innerHTML = head + meta + mdToHtml(body);
}

/* ---------- 列表 ---------- */

function renderList() {
  const kw = $('q').value.trim().toLowerCase();
  const all = state.posts;
  $('c-all').textContent = all.length;
  $('c-draft').textContent = all.filter((p) => p.draft).length;

  const items = all.filter((p) => {
    if (state.filter === 'draft' && !p.draft) return false;
    if (state.filter === 'live' && p.draft) return false;
    return !kw || p.title.toLowerCase().includes(kw) || p.p.toLowerCase().includes(kw);
  });

  if (!items.length) {
    $('list').innerHTML = `<p class="list-empty">${kw ? '没有匹配的文章' : '还没有文章，点右上角「新建」'}</p>`;
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
      (y) => `<div class="ylab"><span>${y}</span><span class="yr"></span><em>${byYear.get(y).length}</em></div>${byYear
        .get(y)
        .map((p) => {
          const on = state.current && state.current.p === p.p;
          return `<div class="row${on ? ' on' : ''}" data-p="${esc(p.p)}" title="${esc(p.title)}">
  ${p.draft ? '<i class="dmark"></i>' : ''}<span class="t">${esc(p.title)}</span>${p.changed ? '<i class="chg" title="有改动未发布"></i>' : ''}<span class="rd">${p.date.slice(5)}</span>
  <button class="del" data-del="${esc(p.p)}" title="删除">×</button>
</div>`;
        })
        .join('')}`
    )
    .join('');

  $('list').querySelectorAll('.row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('del')) return;
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

function markRow() {
  $('list').querySelectorAll('.row').forEach((r) => {
    const on = state.current && r.dataset.p === state.current.p;
    r.classList.toggle('on', !!on);
    if (on) r.scrollIntoView({ block: 'nearest' });
  });
}

/* ---------- 操作 ---------- */

async function loadPosts() {
  state.posts = await api('/api/posts');
  renderList();
}

async function openPost(p) {
  if (state.dirty) await save(true);
  const data = await api('/api/post?p=' + encodeURIComponent(p));
  state.current = { p, summary: data.front.summary || '' };
  $('title').value = data.front.title || '';
  $('date').value = (data.front.date || '').toString().slice(0, 10);
  $('tags').value = (data.front.tags || []).join(', ');
  $('draft').checked = data.front.draft === true;
  $('body').value = data.body.replace(/^\n+/, '').replace(/\s+$/, '');
  $('path').textContent = p.split('/').pop();
  $('crumb').textContent = (data.front.date || '').toString().slice(0, 7).replace('-', ' / ');
  $('btn-del').disabled = false;
  $('btn-pub').disabled = false;
  state.dirty = false;
  setSave('saved', '已保存');
  renderPreview();
  renderList();
  markRow();
  $('body').focus();
  $('body').setSelectionRange(0, 0);
  $('doc').scrollTop = 0;
}

function payload() {
  return {
    p: state.current.p,
    title: $('title').value.trim(),
    date: $('date').value,
    tags: $('tags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    summary: state.current.summary || '',
    draft: $('draft').checked,
    body: $('body').value
  };
}

async function save(silent) {
  if (!state.current || state.saving) return;
  clearTimeout(state.timer);
  state.saving = true;
  setSave('dirty', '保存中…');
  try {
    await api('/api/save', payload());
    state.dirty = false;
    const t = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    setSave('saved', `已保存 ${t}`);
    await loadPosts();
    markRow();
    refreshGit();
    if (!silent) toast('已保存');
  } catch (e) {
    setSave('err', '保存失败');
    toast('保存失败：' + e.message, 4200);
  } finally {
    state.saving = false;
  }
}

function dirty() {
  state.dirty = true;
  setSave('dirty', '有改动未保存');
  clearTimeout(state.timer);
  state.timer = setTimeout(() => save(true), 3500);
  renderPreview();
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
    $('repo-text').textContent = s.remote ? '已连接 GitHub' : '本地仓库';
    $('git-state').textContent = s.changed ? `${s.changed} 个改动未发布` : '工作区干净';
  } catch {
    $('dot').classList.add('bad');
    $('repo-text').textContent = '服务未响应';
  }
}

async function publish() {
  if (!state.current) return;
  $('btn-pub').disabled = true;
  $('pub-text').textContent = '发布中';
  try {
    if (state.dirty) await save(true);
    const r = await api('/api/publish', { message: `post: ${$('title').value.trim()}` });
    if (r.ok) {
      toast(r.note || '已推送，Vercel 正在构建', 4000);
      $('git-state').textContent = '已推送';
    } else {
      const bad = r.steps.find((s) => !s.ok);
      toast(`发布中断 · ${bad ? bad.name + '：' + String(bad.detail).slice(0, 110) : '未知原因'}`, 7000);
    }
    refreshGit();
  } catch (e) {
    toast('发布失败：' + e.message, 6000);
  } finally {
    $('btn-pub').disabled = false;
    $('pub-text').textContent = '发布';
  }
}

/* ---------- 弹窗 ---------- */

function dialog(mode, title, desc, value, okText, danger) {
  state.mode = mode;
  $('dlg-title').textContent = title;
  $('dlg-desc').textContent = desc;
  $('dlg-input').value = value || '';
  $('dlg-input').style.display = mode === 'confirm' ? 'none' : '';
  const ok = $('dlg-ok');
  ok.textContent = okText;
  ok.style.background = danger ? 'var(--danger)' : '';
  $('mask').classList.add('on');
  if (mode !== 'confirm') setTimeout(() => $('dlg-input').focus(), 60);
}

const closeDialog = () => $('mask').classList.remove('on');

function askDelete(p) {
  const post = state.posts.find((x) => x.p === p);
  dialog('delete', '删除这篇文章？', `${post ? post.title : p}\n文件会从本地删除，下一次发布时线上才会消失。`, p, '删除', true);
}

async function confirmDialog() {
  if (state.mode === 'new') {
    const title = $('dlg-input').value.trim();
    if (!title) { $('dlg-input').focus(); return; }
    const r = await api('/api/new', { title });
    closeDialog();
    await loadPosts();
    await openPost(r.p);
    toast('已创建草稿');
    return;
  }
  if (state.mode === 'delete') {
    const p = $('dlg-input').value;
    try {
      await api('/api/delete', { p });
    } catch (e) {
      closeDialog();
      toast('删除失败：' + e.message, 5000);
      return;
    }
    closeDialog();
    if (state.current && state.current.p === p) {
      state.current = null;
      state.dirty = false;
      ['title', 'body', 'date', 'tags'].forEach((id) => ($(id).value = ''));
      $('draft').checked = false;
      $('path').textContent = '';
      $('crumb').textContent = '';
      $('btn-del').disabled = true;
      $('btn-pub').disabled = true;
      setSave('', '未选择文章');
      $('words').textContent = '0 字';
      $('pv-body').innerHTML = '<p class="pv-empty">选择一篇文章开始。</p>';
    }
    await loadPosts();
    if (!state.current && state.posts.length) await openPost(state.posts[0].p);
    refreshGit();
    toast('已删除，发布后线上同步', 3400);
  }
}

/* ---------- 编辑工具 ---------- */

function surround(before, after) {
  const ta = $('body');
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || '文字';
  ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
  ta.focus();
  ta.setSelectionRange(s + before.length, s + before.length + sel.length);
  dirty();
}

function linePrefix(prefix) {
  const ta = $('body');
  const s = ta.selectionStart;
  const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
  const has = ta.value.slice(lineStart, lineStart + prefix.length) === prefix;
  if (has) {
    ta.value = ta.value.slice(0, lineStart) + ta.value.slice(lineStart + prefix.length);
    ta.setSelectionRange(s - prefix.length, s - prefix.length);
  } else {
    ta.value = ta.value.slice(0, lineStart) + prefix + ta.value.slice(lineStart);
    ta.setSelectionRange(s + prefix.length, s + prefix.length);
  }
  ta.focus();
  dirty();
}

function insertText(text) {
  const ta = $('body');
  const s = ta.selectionStart;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(s);
  ta.focus();
  ta.setSelectionRange(s + text.length, s + text.length);
  dirty();
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

/* ---------- 主题 ---------- */

const sunIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/></svg>';
const moonIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';
const eyeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>';
const eyeOffIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><path d="M4 20 20 4"/></svg>';

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('btn-theme').innerHTML = t === 'dark' ? moonIcon : sunIcon;
  localStorage.setItem('theme', t);
}

/* ---------- 事件 ---------- */

['title', 'date', 'tags', 'body'].forEach((id) => $(id).addEventListener('input', dirty));
$('draft').addEventListener('change', dirty);
$('q').addEventListener('input', renderList);
$('btn-new').onclick = () => dialog('new', '新建文章', '文件名会自动带上今天的日期，标题之后还能改。', '', '创建');
$('btn-del').onclick = () => state.current && askDelete(state.current.p);
$('btn-pub').onclick = publish;
$('dlg-cancel').onclick = closeDialog;
$('dlg-ok').onclick = confirmDialog;
$('dlg-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmDialog(); });
$('mask').addEventListener('click', (e) => { if (e.target.id === 'mask') closeDialog(); });

function setPreview(on) {
  $('main').classList.toggle('no-pv', !on);
  $('btn-pv').innerHTML = on ? eyeIcon : eyeOffIcon;
  $('btn-pv').style.color = on ? '' : 'var(--ink-4)';
  localStorage.setItem('pv', on ? '1' : '0');
}
$('btn-pv').onclick = () => setPreview($('main').classList.contains('no-pv'));
$('pv-close').onclick = () => setPreview(false);
$('btn-theme').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

function setFocus(on) {
  document.querySelector('.app').classList.toggle('focus', on);
  $('btn-focus').style.color = on ? 'var(--accent)' : '';
  localStorage.setItem('focus', on ? '1' : '0');
}
$('btn-focus').onclick = () => setFocus(!document.querySelector('.app').classList.contains('focus'));

/* ---------- 命令面板 ---------- */

let palIdx = 0;
let palItems = [];

function palRender() {
  const kw = $('pal-q').value.trim().toLowerCase();
  palItems = state.posts
    .filter((p) => !kw || p.title.toLowerCase().includes(kw) || p.p.toLowerCase().includes(kw))
    .slice(0, 40);
  palIdx = 0;
  if (!palItems.length) {
    $('pal-list').innerHTML = '<p class="pal-empty">没有匹配的文章</p>';
    return;
  }
  $('pal-list').innerHTML = palItems
    .map(
      (p, i) =>
        `<div class="pal-row${i === 0 ? ' on' : ''}" data-i="${i}"><span class="pt">${esc(p.title)}</span><span class="pd">${p.date}</span><span class="pk">↵</span></div>`
    )
    .join('');
  $('pal-list').querySelectorAll('.pal-row').forEach((r) => {
    r.onclick = () => pickPal(Number(r.dataset.i));
  });
}

function palMove(d) {
  const rows = $('pal-list').querySelectorAll('.pal-row');
  if (!rows.length) return;
  rows[palIdx].classList.remove('on');
  palIdx = (palIdx + d + rows.length) % rows.length;
  rows[palIdx].classList.add('on');
  rows[palIdx].scrollIntoView({ block: 'nearest' });
}

function pickPal(i) {
  const p = palItems[i];
  closePalette();
  if (p) openPost(p.p);
}

function openPalette() {
  $('palette').classList.add('on');
  $('pal-q').value = '';
  palRender();
  setTimeout(() => $('pal-q').focus(), 50);
}
const closePalette = () => $('palette').classList.remove('on');

$('pal-q').addEventListener('input', palRender);
$('pal-q').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palMove(1); }
  if (e.key === 'ArrowUp') { e.preventDefault(); palMove(-1); }
  if (e.key === 'Enter') { e.preventDefault(); pickPal(palIdx); }
  if (e.key === 'Escape') closePalette();
});
$('palette').addEventListener('click', (e) => { if (e.target.id === 'palette') closePalette(); });

document.querySelectorAll('.segs .seg').forEach((c) => {
  c.onclick = () => {
    document.querySelectorAll('.segs .seg').forEach((x) => x.classList.remove('on'));
    c.classList.add('on');
    state.filter = c.dataset.f;
    renderList();
  };
});
document.querySelectorAll('.tools .tb').forEach((b) => {
  b.onclick = () => actions[b.dataset.md]();
});

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); actions.bold(); }
  if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); actions.italic(); }
  if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); dialog('new', '新建文章', '文件名会自动带上今天的日期，标题之后还能改。', '', '创建'); }
  if (mod && e.key === '\\') { e.preventDefault(); setFocus(!document.querySelector('.app').classList.contains('focus')); }
  if (e.key === 'Escape') {
    if ($('palette').classList.contains('on')) closePalette();
    else if ($('mask').classList.contains('on')) closeDialog();
    else if (document.activeElement === $('q')) $('body').focus();
  }
});

/* 点空白处继续写 */
$('doc').addEventListener('click', (e) => {
  if (e.target.id === 'doc' || e.target.classList.contains('col')) {
    const ta = $('body');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
});

/* 图片粘贴 / 拖入 */
async function uploadImage(file) {
  const data = await new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(file);
  });
  const r = await api('/api/upload', { name: file.name, data });
  insertText(`\n\n![${file.name.replace(/\.[^.]+$/, '')}](${r.url})\n\n`);
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

/* ---------- 启动 ---------- */

const urlTheme = new URLSearchParams(location.search).get('theme');
applyTheme(urlTheme || localStorage.getItem('theme') || 'light');
setPreview(localStorage.getItem('pv') !== '0');
setFocus(new URLSearchParams(location.search).get('focus') === '1' || localStorage.getItem('focus') === '1');
setSave('', '未选择文章');

loadPosts()
  .then(async () => {
    refreshGit();
    if (state.posts.length) await openPost(state.posts[0].p);
  })
  .catch((e) => {
    $('repo-text').textContent = '服务未响应';
    $('dot').classList.add('bad');
    $('list').innerHTML = '<p class="list-empty">连不上本地服务<br>' + esc(e.message) + '</p>';
  });
