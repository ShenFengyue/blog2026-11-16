// 管理器前端：列表 / 编辑 / 预览 / 保存 / 发布
const $ = (id) => document.getElementById(id);

const state = { posts: [], current: null, dirty: false };

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

/* ---------- 预览用的极简 markdown ---------- */

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
      out.push(`<pre><code>${escHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { out.push('<hr>'); i++; continue; }
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      const items = [];
      const ordered = /^\s*\d+\./.test(line);
      while (i < lines.length && /^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|(?:[-*+]|\d+\.)\s+|(-{3,}|\*{3,}|_{3,})$)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) { buf.push(lines[i]); i++; }
    out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  return out.join('\n');
}

/* ---------- 渲染 ---------- */

function renderPreview() {
  const body = $('body').value;
  const title = $('f-title').value.trim();
  const date = $('f-date').value;
  const words = body.replace(/[#>*_`]/g, '').length;
  $('pv-meta').textContent = body.trim() ? `约 ${Math.max(1, Math.round(words / 350))} 分钟` : '';
  const html = `${title ? `<h1>${escHtml(title)}</h1>` : ''}${date ? `<p class="empty">${date}</p>` : ''}${mdToHtml(body)}`;
  $('preview').innerHTML = html || '<p class="empty">还没有内容。</p>';
}

function renderList() {
  const kw = $('filter').value.trim().toLowerCase();
  const list = state.posts.filter((p) => !kw || p.title.toLowerCase().includes(kw) || p.p.includes(kw));
  $('rows').innerHTML = list.length
    ? list
        .map(
          (p) => `<div class="row${state.current && state.current.p === p.p ? ' on' : ''}" data-p="${p.p}">
  <span class="mark${p.draft ? ' draft' : ''}"></span>
  <div><div class="t">${escHtml(p.title)}</div><div class="d">${p.date}${p.draft ? ' · 草稿' : ''}</div></div>
</div>`
        )
        .join('')
    : '<p style="padding:12px;color:var(--muted);font-size:13px">没有文章。点右上「新建文章」。</p>';
  $('rows').querySelectorAll('.row').forEach((row) => {
    row.onclick = () => openPost(row.dataset.p);
  });
}

function setDirty(d) {
  state.dirty = d;
  $('save-state').textContent = d ? '有改动未保存' : state.current ? '已保存' : '未选择文章';
  $('save-state').style.color = d ? 'var(--warn)' : '';
}

/* ---------- 操作 ---------- */

async function loadPosts() {
  state.posts = await api('/api/posts');
  renderList();
}

async function openPost(p) {
  if (state.dirty && !confirm('当前改动还没保存，确定切换？')) return;
  const data = await api('/api/post?p=' + encodeURIComponent(p));
  state.current = { p };
  $('f-title').value = data.front.title || '';
  $('f-date').value = (data.front.date || '').toString().slice(0, 10);
  $('f-tags').value = (data.front.tags || []).join(', ');
  $('f-sum').value = data.front.summary || '';
  $('f-draft').checked = data.front.draft === true;
  $('body').value = data.body.replace(/^\n+/, '');
  $('f-path').textContent = 'content/posts/' + p;
  $('msg').value = '';
  renderPreview();
  renderList();
  setDirty(false);
}

async function save() {
  if (!state.current) return;
  const payload = {
    p: state.current.p,
    title: $('f-title').value.trim(),
    date: $('f-date').value,
    tags: $('f-tags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    summary: $('f-sum').value.trim(),
    draft: $('f-draft').checked,
    body: $('body').value
  };
  await api('/api/save', payload);
  setDirty(false);
  const t = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  $('save-state').textContent = `已保存 ${t}`;
  await loadPosts();
  await refreshGit();
}

async function refreshGit() {
  try {
    const s = await api('/api/status');
    if (!s.repo) {
      $('dot').classList.add('off');
      $('repo-text').textContent = s.hint;
      $('git-state').textContent = '';
      return;
    }
    $('dot').classList.remove('off');
    $('repo-text').textContent = `${s.remote || '未配置远程'} · ${s.branch}`;
    $('git-state').textContent = s.changed ? `${s.changed} 个文件未提交` : '工作区干净';
  } catch {
    $('dot').classList.add('off');
    $('repo-text').textContent = '无法读取仓库状态';
  }
}

function stepsRender(rows) {
  $('steps').innerHTML = rows
    .map((s) => `<li class="${s.ok ? 'ok' : 'bad'}"><b>${s.ok ? '✓' : '✕'}</b><span>${escHtml(s.name)}${s.detail ? ' · ' + escHtml(s.detail).slice(0, 120) : ''}</span></li>`)
    .join('');
}

async function publish() {
  if (!state.current) return alert('先选择一篇文章');
  const note = $('pub-note');
  note.textContent = '处理中…';
  $('btn-publish').disabled = true;
  try {
    if (state.dirty) await save();
    const title = $('f-title').value.trim();
    const message = $('msg').value.trim() || `post: ${title}`;
    const r = await api('/api/publish', { message });
    stepsRender(r.steps);
    note.textContent = r.ok ? '已推送 · Vercel 约 30–60 秒后上线' : '发布中断';
    if (r.ok) alert(r.note || '已推送');
    await refreshGit();
  } catch (e) {
    stepsRender([{ name: '发布失败', ok: false, detail: e.message }]);
    note.textContent = '失败';
  } finally {
    $('btn-publish').disabled = false;
  }
}

async function createPost() {
  const title = $('new-title').value.trim();
  if (!title) return;
  const r = await api('/api/new', { title });
  $('mask').classList.remove('on');
  $('new-title').value = '';
  await loadPosts();
  await openPost(r.p);
}

/* ---------- 绑定 ---------- */

$('body').addEventListener('input', () => {
  setDirty(true);
  renderPreview();
});
['f-title', 'f-date', 'f-tags', 'f-sum', 'f-draft'].forEach((id) => {
  $(id).addEventListener('input', () => {
    setDirty(true);
    renderPreview();
  });
  $(id).addEventListener('change', () => {
    setDirty(true);
    renderPreview();
  });
});
$('filter').addEventListener('input', renderList);
$('btn-refresh').onclick = async () => {
  await loadPosts();
  await refreshGit();
};
$('btn-save').onclick = save;
$('btn-publish').onclick = publish;
$('btn-new').onclick = () => {
  $('mask').classList.add('on');
  $('new-title').focus();
};
$('new-cancel').onclick = () => $('mask').classList.remove('on');
$('new-ok').onclick = createPost;
$('new-title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createPost();
});
$('btn-theme').onclick = (e) => {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  e.target.textContent = dark ? '暗色' : '亮色';
};

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});

/* 图片拖拽上传 */
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

async function uploadImage(file) {
  const data = await new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(file);
  });
  const r = await api('/api/upload', { name: file.name, data });
  const ta = $('body');
  const insert = `\n![](${r.url})\n`;
  const pos = ta.selectionStart || ta.value.length;
  ta.value = ta.value.slice(0, pos) + insert + ta.value.slice(pos);
  setDirty(true);
  renderPreview();
}

/* 启动 */
setDirty(false);
loadPosts().then(refreshGit).catch((e) => {
  $('repo-text').textContent = '无法连接本地服务：' + e.message;
});
