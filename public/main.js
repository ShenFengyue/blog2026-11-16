// 站点交互：主题、折叠、复制、搜索
(() => {
  const root = document.documentElement;

  // 主题（?theme=dark 可临时预览）
  const forced = new URLSearchParams(location.search).get('theme');
  const saved = forced || localStorage.getItem('theme');
  if (saved === 'dark' || saved === 'light') root.dataset.theme = saved;
  const btn = document.getElementById('theme');
  if (btn) {
    btn.addEventListener('click', () => {
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', root.dataset.theme);
    });
  }

  // 手机端目录抽屉
  const navBtn = document.getElementById('navbtn');
  const sidebar = document.getElementById('sidebar');
  if (navBtn && sidebar) {
    navBtn.addEventListener('click', () => sidebar.classList.toggle('nav-open'));
    sidebar.addEventListener('click', (e) => {
      if (e.target.closest('a')) sidebar.classList.remove('nav-open');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') sidebar.classList.remove('nav-open');
    });
  }

  // 阅读进度
  const bar = document.getElementById('progress');
  const content = document.querySelector('.content');
  if (bar) {
    if (!content) bar.style.display = 'none';
    else {
      const upd = () => {
        const top = content.getBoundingClientRect().top;
        const total = content.offsetHeight - window.innerHeight + 140;
        const done = -top + 100;
        const p = total > 0 ? Math.min(1, Math.max(0, done / total)) : 1;
        bar.style.width = (p * 100).toFixed(2) + '%';
      };
      document.addEventListener('scroll', upd, { passive: true });
      window.addEventListener('resize', upd);
      upd();
    }
  }

  // 侧栏年份折叠（记住状态）
  document.querySelectorAll('.group').forEach((g, i) => {
    if (localStorage.getItem('closed-' + i) === '1') g.classList.add('closed');
    const head = g.querySelector('.group-head');
    if (!head) return;
    head.addEventListener('click', () => {
      g.classList.toggle('closed');
      localStorage.setItem('closed-' + i, g.classList.contains('closed') ? '1' : '0');
    });
  });

  // 目录联动
  const links = [...document.querySelectorAll('.toc a')];
  if (links.length) {
    const targets = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
    const onScroll = () => {
      let current = targets[0];
      for (const t of targets) if (t.getBoundingClientRect().top < 120) current = t;
      links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + (current && current.id)));
    };
    document.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // 代码复制
  document.querySelectorAll('.content pre .copy').forEach((b) => {
    b.addEventListener('click', async () => {
      const code = b.closest('pre').querySelector('code');
      try {
        await navigator.clipboard.writeText(code.textContent);
        b.textContent = '已复制';
        setTimeout(() => (b.textContent = '复制'), 1200);
      } catch {
        b.textContent = '复制失败';
      }
    });
  });

  // ⌘K / Ctrl+K 去搜索页
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      location.href = '/search/';
    }
  });

  // 搜索页
  const q = document.getElementById('q');
  const results = document.getElementById('results');
  if (q && results) {
    let index = [];
    fetch('/search.json')
      .then((r) => r.json())
      .then((d) => {
        index = d;
        render('');
      })
      .catch(() => (results.textContent = '搜索索引加载失败'));
    const render = (kw) => {
      const k = kw.trim().toLowerCase();
      const list = (k ? index.filter((p) => (p.t + p.x).toLowerCase().includes(k)) : index.slice(0, 12)).slice(0, 30);
      results.innerHTML = list.length
        ? list
            .map(
              (p) => `<a class="entry" href="${p.u}"><div class="entry-title">${esc(p.t)}</div><div class="entry-meta">${p.d}</div></a>`
            )
            .join('')
        : '<p class="lead">没有匹配的文章。</p>';
    };
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    q.addEventListener('input', () => render(q.value));
  }
})();
