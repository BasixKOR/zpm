/* ────────── "Do you know Yarn?" quiz logic ────────── */

var QUESTIONS = [
  {
    slug: 'github-install',
    question: 'Can Yarn install a package straight from a GitHub repo?',
    answer: true,
    wrongLine: "Actually — yes, and it's a one-liner.",
    rightLine: "Yes — and the protocol sugar is tiny.",
    explain: [
      "Yarn understands <code>user/repo</code> and <code>github:…</code> shorthands, plus raw Git URLs, branches, tags and commits.",
      "Example: <code>yarn add foo@user/foo#master</code> adds the package directly from GitHub with the branch pinned in the lockfile.",
    ],
  },
  {
    slug: 'no-node-modules',
    question: 'Does Yarn have to create a <code>node_modules</code> folder?',
    answer: false,
    wrongLine: "Not quite — Yarn can skip it entirely.",
    rightLine: "Right — the folder is optional.",
    explain: [
      "Since Yarn 2, the default install strategy is Plug'n'Play: Yarn keeps dependencies in zipped caches and generates a <code>.pnp.cjs</code> resolver that tells Node where to find each package. No <code>node_modules</code>, no phantom deps.",
      "If you prefer a classic layout, you can still opt in with <code>nodeLinker: node-modules</code> in <code>.yarnrc.yml</code>.",
    ],
  },
  {
    slug: 'global-install',
    question: 'Do you need to globally install Yarn before using it?',
    answer: false,
    wrongLine: "Not anymore — Corepack ships it with Node.js.",
    rightLine: "Exactly — Node itself brings Yarn along.",
    explain: [
      "Corepack is bundled with Node.js 16.10+. Run <code>corepack enable</code> once, commit the <code>packageManager</code> field to <code>package.json</code>, and every contributor gets the exact Yarn version your repo expects — no global <code>npm i -g yarn</code> dance.",
      "This also means upgrading Yarn is per-project, via <code>yarn set version</code>.",
    ],
  },
  {
    slug: 'workspaces',
    question: 'Does Yarn support monorepos natively?',
    answer: true,
    wrongLine: "Yep — it's been built in since v1.",
    rightLine: "Right — and workspaces are a flagship feature.",
    explain: [
      "Declare <code>workspaces: [\"packages/*\"]</code> in the root <code>package.json</code> and Yarn links them locally, hoists shared deps, and keeps one lockfile at the root.",
      "No Lerna, no Nx required — although you can still layer them on top if you want task graphs.",
    ],
  },
  {
    slug: 'parallel-scripts',
    question: 'Can Yarn run scripts across every workspace in parallel?',
    answer: true,
    wrongLine: "Yes — <code>workspaces foreach</code> handles it.",
    rightLine: "Correct — one flag away.",
    explain: [
      "<code>yarn workspaces foreach --all --parallel --topological run build</code> runs <code>build</code> in every workspace, respecting the dependency graph.",
      "Add <code>--interlaced</code> to stream logs live, or <code>--jobs 4</code> to cap concurrency.",
    ],
  },
  {
    slug: 'patch-deps',
    question: 'Can Yarn patch a dependency without forking it?',
    answer: true,
    wrongLine: "Yes — <code>yarn patch</code> is built in.",
    rightLine: "Right — and the diff is committed, not the fork.",
    explain: [
      "Run <code>yarn patch &lt;package&gt;</code> to get a scratch copy, edit the files, then <code>yarn patch-commit</code> saves a diff to <code>.yarn/patches/</code> and rewires your resolution automatically.",
      "No <code>patch-package</code> dev dep, no <code>postinstall</code> hook — it's first-class.",
    ],
  },
  {
    slug: 'constraints',
    question: 'Can Yarn enforce consistent versions of a dep across all workspaces?',
    answer: true,
    wrongLine: "Yes — Constraints can enforce exactly that.",
    rightLine: "Correct — that's one of Constraints' core use cases.",
    explain: [
      "Yarn Constraints let you write rules in Prolog or JavaScript that are checked on every install. A typical rule: \u201cevery workspace that depends on <code>react</code> must use the same version.\u201d",
      "Run <code>yarn constraints</code> to audit, <code>yarn constraints --fix</code> to auto-correct.",
    ],
  },
  {
    slug: 'conditional-deps',
    question: 'Does the Yarn lockfile record platform-specific (OS/CPU) dependencies?',
    answer: true,
    wrongLine: "Yes — optional native deps are resolved per-platform.",
    rightLine: "Right — Linux and macOS installs stay reproducible.",
    explain: [
      "Packages with <code>os</code> / <code>cpu</code> / <code>libc</code> fields (think <code>@rollup/rollup-linux-x64-gnu</code>) are tracked as conditional entries. Yarn only installs the variants that match the current platform but keeps all of them in the lockfile.",
      "The result: CI on Linux and your MacBook produce the same lockfile, even though different binaries land on disk.",
    ],
  },
  {
    slug: 'offline',
    question: 'Once installed, can Yarn reinstall the whole project offline?',
    answer: true,
    wrongLine: "Yes — the zip cache is the source of truth.",
    rightLine: "Correct — it's offline-first by design.",
    explain: [
      "Every package Yarn downloads is stored as a single zip in <code>.yarn/cache/</code>. If you commit that folder (or point <code>enableGlobalCache</code> at a shared location), <code>yarn install</code> needs no network.",
      "This is also what makes zero-installs possible: clone the repo and you already have everything.",
    ],
  },
  {
    slug: 'dlx',
    question: 'Can Yarn run a CLI from npm without installing it first?',
    answer: true,
    wrongLine: "Yes — that's what <code>yarn dlx</code> is for.",
    rightLine: "Correct — same spirit as <code>npx</code>.",
    explain: [
      "<code>yarn dlx create-react-app my-app</code> fetches the package into a temporary environment, runs it, and cleans up after itself. Handy for one-shot scaffolders and linters you don't want as permanent deps.",
      "If the command is already installed in the project, use <code>yarn exec</code> instead to avoid re-downloading.",
    ],
  },
];

var LEVELS = [
  { min: 0,  title: 'Curious',   tag: "Plenty to discover — Yarn has more tricks than most devs realize." },
  { min: 4,  title: 'Familiar',  tag: "You know the basics. A few surprises still lurking in the manual." },
  { min: 7,  title: 'Fluent',    tag: "Confidently above average. You've read past the install section." },
  { min: 10, title: 'Expert',    tag: "You might be on the Yarn team. Or you should apply." },
];

/* ────────── State ────────── */
var state = {
  order: [],
  cursor: 0,
  answers: {},
  startedFromSlug: null,
};

/* ────────── Utilities ────────── */
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function slugToIndex(slug) {
  return QUESTIONS.findIndex(function(q) { return q.slug === slug; });
}

function buildOrder() {
  var hash = (location.hash || '').replace(/^#/, '').trim();
  var allIdx = QUESTIONS.map(function(_, i) { return i; });
  if (hash) {
    var startIdx = slugToIndex(hash);
    if (startIdx >= 0) {
      state.startedFromSlug = hash;
      var rest = shuffle(allIdx.filter(function(i) { return i !== startIdx; }));
      return [startIdx].concat(rest);
    }
  }
  return allIdx;
}

function showToast(msg) {
  var el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(function() { el.classList.remove('show'); }, 1800);
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
  return Promise.resolve();
}

/* ────────── Rendering ────────── */
var stage, shell, progressFill, progressNum, scoreNum, progressTotal;

function updateProgress() {
  var total = state.order.length;
  var answered = Object.keys(state.answers).length;
  var correct = 0;
  for (var k in state.answers) if (state.answers[k].correct) correct++;
  progressNum.textContent = Math.min(state.cursor + 1, total);
  progressTotal.textContent = total;
  scoreNum.textContent = correct;
  var pct = (answered / total) * 100;
  progressFill.style.width = pct + '%';
  if (shell) {
    var started = answered > 0 || state.cursor > 0;
    shell.classList.toggle('compact', started);
  }
}

function renderQuestion() {
  updateProgress();
  var total = state.order.length;
  if (state.cursor >= total) {
    renderEnd();
    return;
  }
  var q = QUESTIONS[state.order[state.cursor]];
  history.replaceState(null, '', '#' + q.slug);

  var already = state.answers[q.slug];

  var content = document.createElement('div');
  content.className = 'quiz-stage';
  content.innerHTML =
    '<div class="q-head">' +
      '<div class="q-prompt-col">' +
        '<div class="q-number">Question ' + (state.cursor + 1) + ' of ' + total + '</div>' +
        '<h2 class="q-prompt">' + q.question + '</h2>' +
      '</div>' +
      '<div class="q-answers" role="group" aria-label="Answer">' +
        '<button class="q-btn" data-answer="true">' +
          '<span>Yes</span>' +
          answerIcons() +
        '</button>' +
        '<button class="q-btn" data-answer="false">' +
          '<span>No</span>' +
          answerIcons() +
        '</button>' +
      '</div>' +
    '</div>' +
    '<div class="q-reveal" id="reveal" aria-live="polite"></div>';
  stage.replaceChildren(content);

  var buttons = content.querySelectorAll('.q-btn');
  buttons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      btn.classList.add('pulse');
      handleAnswer(q, btn.dataset.answer === 'true');
    });
  });

  if (already) {
    applyAnswerUI(content, q, already.picked);
  }
}

function answerIcons() {
  return '<svg class="q-icon q-icon-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 8.5 15 16 6"/></svg>' +
    '<svg class="q-icon q-icon-cross" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5 15 15M15 5 5 15"/></svg>';
}

function applyAnswerUI(root, q, picked) {
  var correct = picked === q.answer;
  var buttons = root.querySelectorAll('.q-btn');
  buttons.forEach(function(b) {
    b.disabled = true;
    var btnAnswer = b.dataset.answer === 'true';
    var isPicked = btnAnswer === picked;
    var isCorrectAnswer = btnAnswer === q.answer;
    if (isPicked) {
      b.classList.add('picked', correct ? 'correct' : 'wrong');
    } else if (isCorrectAnswer) {
      b.classList.add('revealed-correct');
    }
  });

  var line = correct ? q.rightLine : q.wrongLine;
  var verdictLabel = correct ? 'Correct' : 'Not quite';
  var verdictClass = correct ? 'right' : 'wrong';

  var reveal = root.querySelector('#reveal');
  reveal.innerHTML =
    '<div class="q-verdict ' + verdictClass + '">' +
      dotIcon(verdictClass) +
      '<span>' + verdictLabel + '</span>' +
    '</div>' +
    '<p class="q-verdict-line">' + line + '</p>' +
    q.explain.map(function(p) { return '<p class="q-explain">' + p + '</p>'; }).join('') +
    '<div class="q-actions">' +
      '<button class="q-next" id="next-btn">' +
        (state.cursor + 1 >= state.order.length ? 'See results' : 'Next question') +
        ' <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h8M8 4l3 3-3 3"/></svg>' +
      '</button>' +
      '<button class="q-share" id="share-btn" aria-label="Copy link to this question">' +
        '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 8.5 L8.5 5.5 M6 4h2.5a2 2 0 0 1 0 4H7 M7 10H5.5a2 2 0 0 1 0-4H6"/></svg>' +
        '<span id="share-label">Share question</span>' +
      '</button>' +
    '</div>';
  reveal.classList.add('open');

  reveal.querySelector('#next-btn').addEventListener('click', advance);
  var shareBtn = reveal.querySelector('#share-btn');
  shareBtn.addEventListener('click', function() {
    var url = location.origin + location.pathname + '#' + q.slug;
    copyToClipboard(url).then(function() {
      shareBtn.classList.add('copied');
      reveal.querySelector('#share-label').textContent = 'Link copied';
      setTimeout(function() {
        shareBtn.classList.remove('copied');
        var lbl = reveal.querySelector('#share-label');
        if (lbl) lbl.textContent = 'Share question';
      }, 1800);
    });
  });
}

function dotIcon(kind) {
  var color = kind === 'right' ? 'var(--accent)' : 'var(--fg-mute)';
  return '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + color + '"></span>';
}

function handleAnswer(q, picked) {
  if (state.answers[q.slug]) return;
  var correct = picked === q.answer;
  state.answers[q.slug] = { picked: picked, correct: correct };
  updateProgress();
  applyAnswerUI(stage.querySelector('.quiz-stage'), q, picked);
}

function advance() {
  state.cursor += 1;
  renderQuestion();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ────────── End screen ────────── */
function renderEnd() {
  history.replaceState(null, '', '#results');
  var total = state.order.length;
  var correct = 0;
  for (var k in state.answers) if (state.answers[k].correct) correct++;
  var level = LEVELS[0];
  for (var i = LEVELS.length - 1; i >= 0; i--) {
    if (correct >= LEVELS[i].min) { level = LEVELS[i]; break; }
  }

  var recap = state.order.map(function(idx) {
    var q = QUESTIONS[idx];
    var a = state.answers[q.slug];
    return '<a class="recap-row" href="#' + q.slug + '" data-slug="' + q.slug + '">' +
      '<span class="recap-dot ' + (a && a.correct ? 'right' : '') + '"></span>' +
      '<span class="recap-text">' + q.question + '</span>' +
      '<svg class="recap-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h8M8 4l3 3-3 3"/></svg>' +
    '</a>';
  }).join('');

  var content = document.createElement('div');
  content.className = 'quiz-stage';
  content.innerHTML =
    '<div class="end-screen">' +
      '<div class="end-level-label">Your Yarn level</div>' +
      '<h2 class="end-level">' + level.title + '</h2>' +
      '<div class="end-score"><span class="num">' + correct + '</span><span class="total"> / ' + total + ' correct</span></div>' +
      '<p class="end-tagline">' + level.tag + '</p>' +
      '<div class="end-actions">' +
        '<button class="q-next" id="restart-btn">' +
          'Play again' +
          ' <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6A5 5 0 1 0 11.5 9.5 M12 3v3h-3"/></svg>' +
        '</button>' +
        '<button class="q-share" id="share-score-btn">' +
          '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 8.5 L8.5 5.5 M6 4h2.5a2 2 0 0 1 0 4H7 M7 10H5.5a2 2 0 0 1 0-4H6"/></svg>' +
          '<span id="share-score-label">Copy shareable link</span>' +
        '</button>' +
      '</div>' +
      '<div class="end-recap">' +
        '<div class="end-recap-title">Your answers \u2014 tap to revisit a question</div>' +
        recap +
      '</div>' +
    '</div>';
  stage.replaceChildren(content);

  document.getElementById('restart-btn').addEventListener('click', restart);
  var sb = document.getElementById('share-score-btn');
  sb.addEventListener('click', function() {
    var url = location.origin + location.pathname;
    copyToClipboard(url).then(function() {
      sb.classList.add('copied');
      document.getElementById('share-score-label').textContent = 'Link copied';
      setTimeout(function() {
        sb.classList.remove('copied');
        var lbl = document.getElementById('share-score-label');
        if (lbl) lbl.textContent = 'Copy shareable link';
      }, 1800);
    });
  });

  content.querySelectorAll('.recap-row').forEach(function(row) {
    row.addEventListener('click', function(e) {
      e.preventDefault();
      var slug = row.dataset.slug;
      var pos = state.order.findIndex(function(i) { return QUESTIONS[i].slug === slug; });
      if (pos >= 0) {
        state.cursor = pos;
        renderQuestion();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });
}

function restart() {
  state.answers = {};
  state.cursor = 0;
  state.order = shuffle(QUESTIONS.map(function(_, i) { return i; }));
  history.replaceState(null, '', location.pathname);
  renderQuestion();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ────────── Init ────────── */
function quizInit() {
  stage = document.getElementById('stage');
  shell = document.querySelector('.quiz-shell');
  progressFill = document.getElementById('progress-fill');
  progressNum = document.getElementById('progress-num');
  scoreNum = document.getElementById('score-num');
  progressTotal = document.getElementById('progress-total');

  if (!stage) return;
  state.order = buildOrder();
  renderQuestion();
}

document.addEventListener('DOMContentLoaded', quizInit);
