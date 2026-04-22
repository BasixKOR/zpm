/* ─────────────── Shared starfield + theme (minimal) ─────────────── */
(function () {
  // Theme
  const saved = localStorage.getItem('yarn-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  window.__theme = saved;

  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('yarn-theme', t);
    window.__theme = t;
    window.dispatchEvent(new CustomEvent('themechange', { detail: t }));
  }
  window.__setTheme = setTheme;

  const btn = document.getElementById('theme-toggle');
  if (btn) btn.addEventListener('click', () => setTheme(window.__theme === 'dark' ? 'light' : 'dark'));

  // Starfield canvas (lighter, non-interactive)
  const canvas = document.getElementById('stars');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W = window.innerWidth, H = window.innerHeight, DPR = 1;
  let stars = [];
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    init();
  }
  function init() {
    // Fewer stars than the landing — reading comfort
    const count = Math.round(180 * (W * H) / (1920 * 1080));
    stars = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.1 + 0.2,
        a: Math.random() * 0.5 + 0.25,
        tp: Math.random() * Math.PI * 2,
        ts: Math.random() * 0.6 + 0.2,
      });
    }
  }
  let t = 0;
  function tick(ts) {
    t = ts * 0.001;
    ctx.clearRect(0, 0, W, H);
    const isDark = window.__theme === 'dark';
    const color = isDark ? '255,255,255' : '255,200,100';
    for (const s of stars) {
      const tw = 0.55 + 0.45 * Math.sin(t * s.ts + s.tp);
      const a = s.a * tw * 0.7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color},${a.toFixed(3)})`;
      ctx.fill();
    }
    requestAnimationFrame(tick);
  }
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(tick);
})();

/* ─────────────── Docs-specific features ─────────────── */
(function () {
  /* Toast */
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  document.body.appendChild(toast);
  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  }
  window.__showToast = showToast;

  /* Heading anchors: inject # link, click = copy URL */
  function slugify(s) {
    return s.toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  /* Field anchors — same copy-link behavior as headings */
  document.querySelectorAll('.field[id]').forEach(f => {
    if (f.querySelector('.field-anchor')) return;
    const head = f.querySelector('.field-head');
    if (!head) return;
    const anchor = document.createElement('a');
    anchor.href = '#' + f.id;
    anchor.className = 'field-anchor';
    anchor.setAttribute('aria-label', 'Copy link to this field');
    anchor.textContent = '#';
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      const url = location.origin + location.pathname + '#' + f.id;
      history.replaceState(null, '', '#' + f.id);
      navigator.clipboard?.writeText(url).then(
        () => showToast('Link copied'),
        () => showToast('Press ⌘C to copy')
      );
    });
    head.insertBefore(anchor, head.firstChild);
  });

  document.querySelectorAll('.prose h2, .prose h3, .prose h4').forEach(h => {
    if (!h.id) h.id = slugify(h.textContent || '');
    // Wrap children in a span, append anchor
    const wrap = document.createElement('span');
    wrap.className = 'heading-wrap';
    // Move children
    const text = document.createElement('span');
    while (h.firstChild) text.appendChild(h.firstChild);
    wrap.appendChild(text);
    const anchor = document.createElement('a');
    anchor.href = '#' + h.id;
    anchor.className = 'heading-anchor';
    anchor.setAttribute('aria-label', 'Copy link to this section');
    anchor.textContent = '#';
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      const url = location.origin + location.pathname + '#' + h.id;
      history.replaceState(null, '', '#' + h.id);
      navigator.clipboard?.writeText(url).then(
        () => showToast('Link copied'),
        () => showToast('Press ⌘C to copy')
      );
    });
    wrap.appendChild(anchor);
    h.appendChild(wrap);
  });

  /* Copy buttons on terminal + code blocks */
  document.querySelectorAll('.terminal, .code-block').forEach(el => {
    if (el.querySelector('.copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.setAttribute('aria-label', 'Copy code');
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="7" height="7" rx="1"/><path d="M2 8V2h6" opacity="0.6"/></svg>';
    btn.addEventListener('click', () => {
      // Strip '$ ' prompt + '# ' from terminal, else raw text
      const text = Array.from(el.querySelectorAll('.term-line, pre code, pre'))
        .map(line => {
          if (line.classList && line.classList.contains('term-line')) {
            if (line.classList.contains('no-prompt') || line.classList.contains('out')) return line.textContent;
            if (line.classList.contains('comment')) return '# ' + line.textContent;
            return '$ ' + line.textContent;
          }
          return line.textContent;
        })
        .join('\n') || el.textContent;
      const toCopy = el.classList.contains('terminal')
        ? Array.from(el.querySelectorAll('.term-line'))
            .filter(l => !l.classList.contains('out') && !l.classList.contains('comment'))
            .map(l => l.textContent)
            .join('\n')
        : (el.querySelector('pre code') || el.querySelector('pre')).textContent;
      navigator.clipboard?.writeText(toCopy).then(() => {
        btn.classList.add('copied');
        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 6l3 3 5-6"/></svg>';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="7" height="7" rx="1"/><path d="M2 8V2h6" opacity="0.6"/></svg>';
        }, 1400);
      });
    });
    const target = el.classList.contains('code-block') ? el.querySelector('pre') || el : el;
    target.appendChild(btn);
  });

  /* ── Syntax highlighter (lightweight regex-based) ── */
  // Supports: js, ts, json, bash, yaml, diff, jsx, html
  const LANG_RULES = {
    js: [
      ['comment', /\/\/[^\n]*|\/\*[\s\S]*?\*\//g],
      ['string', /(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)/g],
      ['keyword', /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|this|super|import|export|from|as|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|null|undefined|true|false)\b/g],
      ['number', /\b(0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi],
      ['func', /\b([a-zA-Z_$][\w$]*)(?=\s*\()/g],
      ['punct', /[{}[\]();,.:]/g],
    ],
    json: [
      ['string', /"(?:\\.|[^"\\])*"(?=\s*:)/g],
      ['prop', /"(?:\\.|[^"\\])*"/g],
      ['number', /\b-?\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi],
      ['keyword', /\b(true|false|null)\b/g],
      ['punct', /[{}[\],:]/g],
    ],
    yaml: [
      ['comment', /#[^\n]*/g],
      ['string', /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g],
      ['prop', /^(\s*)([A-Za-z_][\w-]*)(?=\s*:)/gm],
      ['number', /\b-?\d+(?:\.\d+)?\b/g],
      ['keyword', /\b(true|false|null|yes|no|on|off)\b/gi],
      ['punct', /[:[\]{},-]/g],
    ],
    bash: [
      ['comment', /#[^\n]*/g],
      ['string', /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g],
      ['keyword', /\b(if|then|else|fi|for|while|do|done|case|esac|function|return|in)\b/g],
      ['func', /^(\w+)/gm],
      ['flag', /\s(-{1,2}[\w-]+)/g],
      ['number', /\b\d+\b/g],
    ],
    diff: [
      ['added', /^\+[^\n]*/gm],
      ['removed', /^-[^\n]*/gm],
      ['meta', /^@@[^\n]*@@/gm],
    ],
    html: [
      ['comment', /<!--[\s\S]*?-->/g],
      ['string', /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g],
      ['tag', /<\/?[a-zA-Z][\w-]*/g],
      ['attr', /\s([a-zA-Z-:][\w-]*)(?==)/g],
      ['punct', /[<>/]/g],
    ],
  };
  LANG_RULES.ts = LANG_RULES.tsx = LANG_RULES.jsx = LANG_RULES.js;

  function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function highlight(code, lang) {
    const rules = LANG_RULES[lang];
    if (!rules) return escHtml(code);
    // Tokenize by scanning, taking first match at each position
    const tokens = [];
    let i = 0;
    const N = code.length;
    // Pre-run regexes with global flag — iterate matches
    const matchSets = rules.map(([type, re]) => {
      re.lastIndex = 0;
      const matches = [];
      let m;
      // Use exec in loop
      const cloned = new RegExp(re.source, re.flags);
      while ((m = cloned.exec(code)) !== null) {
        if (m[0].length === 0) { cloned.lastIndex++; continue; }
        matches.push({ type, start: m.index, end: m.index + m[0].length, text: m[0] });
      }
      return matches;
    });
    // Merge: prefer earlier start; ties go to earlier rule (higher priority)
    const flat = [].concat(...matchSets).sort((a, b) => a.start - b.start || a.end - b.end);
    let out = '';
    let cursor = 0;
    for (const tk of flat) {
      if (tk.start < cursor) continue;
      if (tk.start > cursor) out += escHtml(code.slice(cursor, tk.start));
      const cls = 'tok-' + tk.type;
      out += `<span class="${cls}">${escHtml(tk.text)}</span>`;
      cursor = tk.end;
    }
    if (cursor < N) out += escHtml(code.slice(cursor));
    return out;
  }

  document.querySelectorAll('.code-block pre code[data-lang]').forEach(codeEl => {
    const lang = codeEl.dataset.lang;
    const raw = codeEl.textContent;
    codeEl.innerHTML = highlight(raw, lang);
  });

  /* Scrollspy for sidebar: mark active link based on scroll */
  const sbLinks = document.querySelectorAll('.docs-sidebar a.sb-link[data-section]');
  if (sbLinks.length) {
    const sections = Array.from(document.querySelectorAll('.prose h2[id], .prose h3[id]'));
    function onScroll() {
      const y = window.scrollY + 120;
      let activeId = sections[0]?.id;
      for (const s of sections) { if (s.offsetTop <= y) activeId = s.id; }
      sbLinks.forEach(a => {
        const want = a.getAttribute('href')?.replace(/^#/, '');
        a.classList.toggle('active', want === activeId);
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* Smooth anchor scroll */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    window.scrollTo({ top: el.offsetTop - 80, behavior: 'smooth' });
    history.replaceState(null, '', '#' + id);
  });
})();
