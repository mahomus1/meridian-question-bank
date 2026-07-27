/* Application shell: boot, chrome, routing, and global keyboard handling. */

import { h, fill, $, $$ } from './core/dom.js';
import * as store from './core/store.js';
import { loadIndex, bank, filterItems } from './core/bank.js';
import { route, start, go, render as rerender, here } from './core/router.js';
import { toast } from './features/overlay.js';
import * as panel from './features/notepanel.js';
import { n as num } from './core/fmt.js';

/* ── theme ────────────────────────────────────────────────────────────── */

const media = matchMedia('(prefers-color-scheme: dark)');

export function applyTheme() {
  const pref = store.prefs().theme;
  const resolved = pref === 'auto' ? (media.matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}
media.addEventListener('change', () => { if (store.prefs().theme === 'auto') applyTheme(); });
store.on('prefs', ({ k }) => {
  if (k === 'theme') applyTheme();
  if (k === 'fontScale') applyFontScale();
});

function applyFontScale() {
  const s = store.prefs().fontScale || 1;
  document.documentElement.style.setProperty('--prose-scale', s);
  document.documentElement.style.fontSize = `${16 * (0.94 + s * 0.06)}px`;
}

/* ── chrome ───────────────────────────────────────────────────────────── */

function paintTopbar(view) {
  const bar = $('#topbar');
  if (!view || view.error) { fill(bar, h('div.topbar__title', h('h1', 'Meridian'))); return; }
  if (view.chrome === false) { bar.hidden = true; return; }
  bar.hidden = false;
  fill(bar,
    h('div.topbar__title',
      h('h1', view.title || 'Meridian'),
      view.subtitle && h('p', view.subtitle)),
    h('div.topbar__actions',
      view.actions || null,
      h('button.btn.btn--sm', {
        'data-panel-toggle': '',
        'aria-pressed': String(panel.isOpen()),
        title: 'Notebook  ⌘J',
        onclick: () => panel.toggle(),
      }, 'Notebook')),
  );
}

function paintRail() {
  const path = here();
  const seg = path.split('/')[1] || '';
  const map = {
    '': 'dashboard', create: 'create', browse: 'browse', notebook: 'notebook',
    performance: 'performance', tests: 'tests', settings: 'settings',
    highlights: 'highlights',
    test: 'tests', results: 'tests',
  };
  const activeKey = map[seg] ?? '';
  for (const link of $$('.rail__link')) {
    const on = link.dataset.nav === activeKey;
    if (on) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  const notes = store.state.notes.length;
  const tests = store.state.tests.length;
  const hls = store.highlightCount();
  $('[data-count="notes"]').textContent = notes ? num(notes) : '';
  $('[data-count="tests"]').textContent = tests ? num(tests) : '';
  const hlEl = $('[data-count="highlights"]');
  if (hlEl) hlEl.textContent = hls ? num(hls) : '';

  const o = store.overall();
  const total = bank.index?.meta.total || 0;
  fill($('#railProgress'),
    h('div.row', { style: { justifyContent: 'space-between' } },
      h('span.label', 'Bank progress'),
      h('b.num', `${Math.round((o.done / (total || 1)) * 100)}%`)),
    h('div.meter.meter--sm',
      h('div.meter__fill', { style: { width: `${(o.done / (total || 1)) * 100}%` } })),
    h('div.xs.muted', `${num(o.done)} of ${num(total)} answered`),
  );
}

store.on('*', (topic) => {
  if (['notes', 'tests', 'answers', 'reset', 'notebooks', 'highlights', 'capture'].includes(topic)) paintRail();
});

store.on('quota', () => {
  toast('Storage is full — some changes may not be saved. Export your data from Settings.', { ms: 9000 });
});

/* ── routes ───────────────────────────────────────────────────────────── */

const lazy = (path) => (params) => import(path).then((m) => m.default(params));

route('/', lazy('./views/dashboard.js'));
route('/create', lazy('./views/create.js'));
route('/browse', lazy('./views/browse.js'));
route('/browse/:id', lazy('./views/browse.js'));
route('/test/:id', lazy('./views/runner.js'));
route('/results/:id', lazy('./views/results.js'));
route('/tests', lazy('./views/tests.js'));
route('/highlights', lazy('./views/highlights.js'));
route('/notebook', lazy('./views/notebook.js'));
route('/notebook/:noteId', lazy('./views/notebook.js'));
route('/performance', lazy('./views/performance.js'));
route('/settings', lazy('./views/settings.js'));

function paint(view, ctx) {
  const host = $('#view');

  if (!view) {
    fill(host, h('div.wrap',
      h('div.empty',
        h('div.empty__mark', '?'),
        h('h3', 'Page not found'),
        h('p', `Nothing lives at ${ctx.path}.`),
        h('a.btn.btn--primary', { href: '#/' }, 'Back to overview'))));
    paintTopbar(null); paintRail();
    return;
  }

  if (view.error) {
    console.error(view.error);
    fill(host, h('div.wrap',
      h('div.empty',
        h('div.empty__mark', '!'),
        h('h3', 'Something went wrong'),
        h('p', view.error.message || 'This view could not be displayed.'),
        h('button.btn', { onclick: () => rerender() }, 'Try again'))));
    paintTopbar(view); paintRail();
    return;
  }

  host.classList.toggle('view--fixed', !!view.fixed);
  fill(host, view.el);
  paintTopbar(view);
  paintRail();
  host.scrollTop = 0;
  document.title = view.title ? `${view.title} — Meridian` : 'Meridian';
  view.mounted?.();
}

/* ── command palette ──────────────────────────────────────────────────── */

let paletteOpen = false;

function openPalette() {
  if (paletteOpen) return;
  paletteOpen = true;
  const root = $('#palette');
  let sel = 0;
  let results = [];

  const listEl = h('div.palette__list', { role: 'listbox' });
  const input = h('input.palette__input', {
    type: 'text', placeholder: 'Search questions, notes, and pages…',
    'aria-label': 'Search', autocomplete: 'off', spellcheck: false,
  });

  const NAV = [
    { label: 'Overview', hint: 'Page', go: '/' },
    { label: 'Create test', hint: 'Page', go: '/create' },
    { label: 'Question bank', hint: 'Page', go: '/browse' },
    { label: 'Notebook', hint: 'Page', go: '/notebook' },
    { label: 'Highlights', hint: 'Page', go: '/highlights' },
    { label: 'Performance', hint: 'Page', go: '/performance' },
    { label: 'Test history', hint: 'Page', go: '/tests' },
    { label: 'Settings', hint: 'Page', go: '/settings' },
  ];

  function search(q) {
    const query = q.trim().toLowerCase();
    if (!query) return NAV;
    const out = NAV.filter((x) => x.label.toLowerCase().includes(query));

    for (const note of store.state.notes) {
      if (out.length > 22) break;
      if (`${note.title} ${note.body}`.toLowerCase().includes(query)) {
        out.push({ label: note.title || 'Untitled note', hint: 'Note', go: `/notebook/${note.id}` });
      }
    }
    const items = filterItems({ query }).slice(0, 22 - out.length);
    for (const it of items) {
      out.push({ label: `${it.topic} — ${it.archetypeLabel}`, hint: it.id, go: `/browse/${it.id}` });
    }
    return out;
  }

  function draw() {
    fill(listEl, results.length
      ? results.map((r, i) => h('button.palette__item', {
        type: 'button', role: 'option', 'aria-selected': String(i === sel),
        onmousemove: () => { if (sel !== i) { sel = i; draw(); } },
        onclick: () => { close(); go(r.go); },
      }, h('span', r.label), h('small', r.hint)))
      : h('p.palette__sec.muted.sm', 'No matches.'));
    listEl.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function close() {
    paletteOpen = false;
    root.hidden = true;
    root.replaceChildren();
    document.removeEventListener('keydown', onKey, true);
  }

  function onKey(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); sel = Math.min(results.length - 1, sel + 1); draw(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (ev.key === 'Enter' && results[sel]) { ev.preventDefault(); close(); go(results[sel].go); }
  }

  input.addEventListener('input', () => { results = search(input.value); sel = 0; draw(); });
  results = search('');
  draw();

  fill(root, h('div.palette__box', { role: 'dialog', 'aria-label': 'Search' }, input, listEl));
  root.hidden = false;
  root.onclick = (ev) => { if (ev.target === root) close(); };
  document.addEventListener('keydown', onKey, true);
  input.focus();
}

/* ── global keys ──────────────────────────────────────────────────────── */

const isTyping = () => {
  const el = document.activeElement;
  if (!el) return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  return !!el.closest?.('.panel, .modal, .palette');
};

addEventListener('keydown', (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
    ev.preventDefault(); openPalette(); return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'j') {
    ev.preventDefault(); panel.toggle(); return;
  }
  if (isTyping() || ev.metaKey || ev.ctrlKey || ev.altKey) return;

  if (ev.key === '/') { ev.preventDefault(); openPalette(); }
  else if (ev.key === '?') {
    ev.preventDefault();
    import('./views/shortcuts.js').then((m) => m.showShortcuts());
  }
});

/* ── keeping up to date ───────────────────────────────────────────────── */

/* A page already open holds its modules until it reloads, and Pages serves the
   scripts with a ten-minute cache. Between them, a deploy could go unnoticed
   and the reader would keep using the previous build. The entry module's ETag
   is compared against the one last seen; when it moves, the asset cache is
   refreshed and the page loads once more. */
const BUILD_KEY = 'meridian.build';
const ASSETS = [
  'assets/css/app.css', 'assets/css/views.css',
  'assets/js/main.js',
  'assets/js/core/dom.js', 'assets/js/core/store.js', 'assets/js/core/bank.js',
  'assets/js/core/router.js', 'assets/js/core/fmt.js',
  'assets/js/render/figure.js', 'assets/js/render/table.js',
  'assets/js/render/prose.js', 'assets/js/render/item.js',
  'assets/js/features/overlay.js', 'assets/js/features/capture.js',
  'assets/js/features/highlight.js', 'assets/js/features/notepanel.js',
  'assets/js/features/blockdrag.js', 'assets/js/features/docx.js',
  'assets/js/features/zip.js',
  'assets/js/views/dashboard.js', 'assets/js/views/create.js',
  'assets/js/views/runner.js', 'assets/js/views/results.js',
  'assets/js/views/browse.js', 'assets/js/views/notebook.js',
  'assets/js/views/highlights.js', 'assets/js/views/performance.js',
  'assets/js/views/tests.js', 'assets/js/views/settings.js',
  'assets/js/views/parts.js', 'assets/js/views/shortcuts.js',
];

async function refreshIfStale() {
  let tag;
  try {
    const res = await fetch('assets/js/main.js', { method: 'HEAD', cache: 'no-store' });
    tag = res.headers.get('etag') || res.headers.get('last-modified');
  } catch { return; }            // offline: carry on with what is loaded
  if (!tag) return;

  const seen = localStorage.getItem(BUILD_KEY);
  localStorage.setItem(BUILD_KEY, tag);
  if (!seen || seen === tag) return;

  await Promise.all(ASSETS.map((p) => fetch(p, { cache: 'reload' }).catch(() => {})));
  location.reload();
}

/* ── boot ─────────────────────────────────────────────────────────────── */

async function boot() {
  refreshIfStale();
  applyTheme();
  applyFontScale();
  store.ensureNotebook();

  try {
    await loadIndex();
  } catch (err) {
    $('#boot').innerHTML = '';
    $('#boot').appendChild(h('div.empty',
      h('div.empty__mark', '!'),
      h('h3', 'The question bank could not be loaded'),
      h('p', `${err.message} If you opened this file directly, serve the folder over HTTP instead — browsers block local data files.`)));
    return;
  }

  $('#app').hidden = false;
  panel.mount();
  start(paint);
  paintRail();

  const boot$ = $('#boot');
  boot$.classList.add('boot--gone');
  setTimeout(() => boot$.remove(), 320);
}

boot();

export { openPalette };
