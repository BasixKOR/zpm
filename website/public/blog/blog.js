(function () {
  function slugify(s) {
    return (s || '').toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function toast(msg) {
    let t = document.querySelector('.blog-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'blog-toast';
      t.setAttribute('role', 'status');
      Object.assign(t.style, {
        position: 'fixed', left: '50%', bottom: '28px',
        transform: 'translateX(-50%) translateY(10px)',
        padding: '10px 16px', borderRadius: '10px',
        background: 'color-mix(in oklch, var(--bg-0) 80%, transparent)',
        border: '1px solid var(--line-strong)', color: 'var(--fg)',
        fontSize: '13px', fontFamily: 'inherit', zIndex: 100,
        backdropFilter: 'blur(10px)', opacity: '0',
        transition: 'opacity 0.2s, transform 0.2s', pointerEvents: 'none',
      });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => {
      t.style.opacity = '1';
      t.style.transform = 'translateX(-50%) translateY(0)';
    });
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateX(-50%) translateY(10px)';
    }, 1600);
  }

  var prose = document.querySelector('.article-prose');
  if (!prose) return;

  var headings = Array.from(prose.querySelectorAll('h2, h3'));
  var used = new Set();
  headings.forEach(function (h) {
    if (!h.id) {
      var base = slugify(h.textContent || '');
      var id = base, n = 2;
      while (used.has(id) || document.getElementById(id)) { id = base + '-' + (n++); }
      h.id = id;
    }
    used.add(h.id);
    var a = document.createElement('a');
    a.href = '#' + h.id;
    a.className = 'anchor-link';
    a.textContent = '#';
    a.setAttribute('aria-label', 'Copy link to this section');
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var url = location.origin + location.pathname + '#' + h.id;
      history.replaceState(null, '', '#' + h.id);
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(
          function () { toast('Link copied'); },
          function () { toast('Press \u2318C to copy'); }
        );
      }
    });
    h.appendChild(a);
  });

  var h2s = headings.filter(function (h) { return h.tagName === 'H2'; });
  if (h2s.length >= 4) {
    var toc = document.createElement('nav');
    toc.className = 'toc';
    toc.setAttribute('aria-label', 'Table of contents');
    toc.innerHTML = '<div class="toc-label">On this page</div><ol></ol>';
    var ol = toc.querySelector('ol');
    h2s.forEach(function (h) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + h.id;
      var clone = h.cloneNode(true);
      clone.querySelectorAll('.anchor-link').forEach(function (n) { n.remove(); });
      a.textContent = clone.textContent.trim();
      li.appendChild(a);
      ol.appendChild(li);
    });
    document.body.appendChild(toc);
    requestAnimationFrame(function () { toc.classList.add('ready'); });

    var links = Array.from(toc.querySelectorAll('a'));
    function onScroll() {
      var y = window.scrollY + 140;
      var activeId = h2s[0].id;
      for (var i = 0; i < h2s.length; i++) {
        if (h2s[i].offsetTop <= y) activeId = h2s[i].id;
      }
      links.forEach(function (l) {
        l.classList.toggle('active', l.getAttribute('href') === '#' + activeId);
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    window.scrollTo({ top: el.offsetTop - 90, behavior: 'smooth' });
    history.replaceState(null, '', '#' + id);
  });

  document.querySelectorAll('[data-share="copy-url"]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var url = location.href;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(
          function () { toast('Link copied'); },
          function () { toast('Press \u2318C to copy'); }
        );
      }
    });
  });
})();
