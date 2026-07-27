/* The notebook, as an editor beside the page.

   One panel, open on any view, holding one note. What is open here is also
   where clippings land, so there is nothing to configure.

   The document is plain: a clipped passage is an ordinary paragraph in the same
   face as everything else, carrying its origin as an attribute. The first line
   is the title, the way a page of paper works — there is no separate field for
   it. Formatting appears on selection or from the shortcuts you already know,
   and markdown shorthand converts as you type. */

import { h, fill, $ } from '../core/dom.js';
import * as store from '../core/store.js';
import { meta, cat } from '../core/bank.js';
import { go } from '../core/router.js';
import { ago } from '../core/fmt.js';
import { markdown } from '../render/prose.js';
import { figureSvg } from '../render/figure.js';
import { tableBlock } from '../render/table.js';
import { toast, confirm, prompt, modal } from './overlay.js';
import { enableBlockDrag } from './blockdrag.js';

let root = null;
let docEl = null;
let saveTimer = null;
let detachDrag = null;
let writing = false;        // true while the panel is saving its own edits
let fmtBar = null;

const MIN_W = 300;
const MAX_W = 760;

/* ── which note is open ───────────────────────────────────────────────── */

export function activeNote() {
  const pinned = store.captureTarget();
  if (pinned) return pinned;
  const first = store.state.notes[0];
  if (first) { store.setCaptureTarget(first.id); return first; }
  const note = store.createNote({ title: '' });
  store.setCaptureTarget(note.id);
  return note;
}

export function openNote(id) {
  store.setCaptureTarget(id);
  setOpen(true);
  draw();
}

/** The first line of a note is its name. */
export function noteTitle(note) {
  if (note.title) return note.title;
  const box = document.createElement('div');
  box.innerHTML = note.html || markdown(note.body || '');
  for (const el of box.children) {
    const t = (el.textContent || '').trim();
    if (t) return t.length > 70 ? `${t.slice(0, 70)}…` : t;
  }
  return 'New note';
}

/* ── open / close / size ──────────────────────────────────────────────── */

export const isOpen = () => !!store.prefs().panelOpen;

export function setOpen(on) {
  store.setPref('panelOpen', !!on);
  apply();
  if (on) draw();
}

export const toggle = () => setOpen(!isOpen());

function apply() {
  const app = $('#app');
  if (!app) return;
  app.classList.toggle('app--panel', isOpen());
  app.style.setProperty('--panel-w', `${store.prefs().panelWidth || 380}px`);
  if (root) root.hidden = !isOpen();
  $('[data-panel-toggle]')?.setAttribute('aria-pressed', String(isOpen()));
}

/* ── mount ────────────────────────────────────────────────────────────── */

export function mount() {
  root = h('aside.panel', { hidden: !isOpen(), 'aria-label': 'Notebook' });
  $('#app')?.appendChild(root);
  apply();
  if (isOpen()) draw();

  // Redraw only for changes made elsewhere. Redrawing on the panel's own saves
  // would rebuild the editable element under the caret on every keystroke.
  store.on('notes', () => { if (!writing && isOpen()) draw(); });
  store.on('capture', () => { if (isOpen()) draw(); });
  return root;
}

/* ── drawing ──────────────────────────────────────────────────────────── */

export function draw() {
  if (!root || !isOpen()) return;
  const note = activeNote();
  const book = store.notebookById(note.book);

  docEl = h('div.doc', {
    contenteditable: 'true', spellcheck: 'true',
    role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Note',
    dataset: { sources: store.prefs().showSources === false ? 'off' : 'on' },
    html: note.html || '<p><br></p>',
    oninput: onInput,
    onkeydown: onKey,
    onclick: onDocClick,
    onblur: hideFmt,
    onpaste: (ev) => {
      ev.preventDefault();
      document.execCommand('insertText', false, ev.clipboardData.getData('text/plain'));
    },
  });

  fill(root,
    h('div.panel__grip', { title: 'Drag to resize', onpointerdown: startResize }),

    h('header.panel__head',
      h('button.panel__book', { title: 'Switch or create a note', onclick: switchNote },
        h('span.dot', { style: { background: book?.color || 'var(--ink-4)' } }),
        h('span.truncate', book?.name || 'General'),
        h('span.dest__chev', '▾')),
      h('div.push.row', { style: { gap: '2px' } },
        h('button.panel__ico', { title: 'New note', 'aria-label': 'New note', onclick: newNote }, '+'),
        h('button.panel__ico', { title: 'More', 'aria-label': 'More', onclick: moreMenu }, '···'),
        h('button.panel__ico', { title: 'Close  ⌘J', 'aria-label': 'Close notebook', onclick: () => setOpen(false) }, '✕'))),

    h('div.panel__body',
      h('div.panel__inner', h('div.doc-wrap', docEl))),

    h('footer.panel__foot',
      h('span.truncate', `Edited ${ago(note.updated)}`),
      h('label.panel__srcs', { title: 'Show a mark where text came from a question' },
        h('input', {
          type: 'checkbox', checked: store.prefs().showSources !== false,
          onchange: (ev) => {
            store.setPref('showSources', ev.target.checked);
            docEl.dataset.sources = ev.target.checked ? 'on' : 'off';
          },
        }),
        h('span', 'Sources'))),
  );

  hydrate(note);
  markEmpty();
  try {
    document.execCommand('defaultParagraphSeparator', false, 'p');
    // Semantic <b>/<i> rather than inline-styled spans: cleaner to store,
    // cleaner to export, and it survives a theme change.
    document.execCommand('styleWithCSS', false, false);
  } catch { /* unsupported */ }

  detachDrag?.();
  detachDrag = enableBlockDrag(root.querySelector('.doc-wrap'), docEl, () => {
    clearTimeout(saveTimer);
    persist({ html: serialise() });
  });
}

/* ── saving ───────────────────────────────────────────────────────────── */

/** Write without tripping the panel's own redraw. */
function persist(patch) {
  const note = activeNote();
  if (!note) return;
  writing = true;
  store.updateNote(note.id, patch);
  writing = false;
}

function queue(getPatch) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(getPatch()), 400);
}

function serialise() {
  const copy = docEl.cloneNode(true);
  copy.querySelectorAll('.doc-obj').forEach((el) => {
    el.replaceChildren();
    el.removeAttribute('style');
  });
  const norm = document.createElement('div');
  norm.innerHTML = copy.innerHTML;
  return norm.innerHTML;
}

function onInput() {
  // Running execCommand inside the input event it is reacting to is reentrant
  // and silently does nothing, so the shorthand is applied just after.
  setTimeout(autoFormat, 0);
  markEmpty();
  queue(() => ({ html: serialise() }));
}

/* ── document plumbing ────────────────────────────────────────────────── */

function hydrate(note) {
  for (const el of docEl.querySelectorAll('.doc-obj')) {
    const c = note.clips.find((x) => x.id === el.dataset.clip);
    if (!c) { el.remove(); continue; }
    el.setAttribute('contenteditable', 'false');
    fill(el, objectBlock(note, c));
  }
  guardEnds();
}

function guardEnds() {
  const solid = (el) => el && !el.classList.contains('doc-obj');
  if (!solid(docEl.firstElementChild)) docEl.insertBefore(h('p', h('br')), docEl.firstElementChild);
  if (!solid(docEl.lastElementChild)) docEl.appendChild(h('p', h('br')));
}

function objectBlock(note, c) {
  const remove = h('button.doc-obj__x', {
    title: 'Remove', 'aria-label': 'Remove',
    onclick: () => { store.removeClip(note.id, c.id); draw(); },
  }, '✕');
  if (c.kind === 'figure') {
    return [remove, h('figure.doc-fig', figureSvg(c.spec), h('figcaption', c.spec.title))];
  }
  return [remove, h('div.doc-tbl', tableBlock(c.spec))];
}

function markEmpty() {
  const blank = !docEl.querySelector('.doc-obj') && !docEl.textContent.trim();
  docEl.dataset.empty = blank ? '1' : '';
}

function blockOf(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  return el?.closest('.doc > *') || null;
}

/* ── markdown shorthand, converted as you type ────────────────────────── */

const RULES = [
  [/^###\s/, () => document.execCommand('formatBlock', false, 'h3')],
  [/^##\s/, () => document.execCommand('formatBlock', false, 'h2')],
  [/^#\s/, () => document.execCommand('formatBlock', false, 'h1')],
  [/^[-*]\s/, () => document.execCommand('insertUnorderedList')],
  [/^1[.)]\s/, () => document.execCommand('insertOrderedList')],
  [/^>\s/, () => document.execCommand('formatBlock', false, 'blockquote')],
  [/^---$/, () => document.execCommand('insertHorizontalRule')],
];

function autoFormat() {
  const sel = getSelection();
  if (!sel?.isCollapsed) return;
  const block = blockOf(sel.anchorNode);
  if (!block || block.tagName !== 'P' || block.dataset.qid) return;

  const text = block.textContent;
  for (const [re, apply] of RULES) {
    const m = re.exec(text);
    if (!m) continue;
    const first = block.firstChild;
    if (!first || first.nodeType !== Node.TEXT_NODE) return;

    const r = document.createRange();
    r.setStart(first, 0);
    r.setEnd(first, Math.min(m[0].length, first.nodeValue.length));
    sel.removeAllRanges();
    sel.addRange(r);
    document.execCommand('delete');
    apply();
    return;
  }
}

/* ── formatting bar, on selection ─────────────────────────────────────── */

function exec(cmd, arg) {
  // Focusing the editor can collapse the very selection the command needs, so
  // the range is captured first and put back before the command runs.
  const sel = getSelection();
  const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  if (document.activeElement !== docEl) docEl.focus();
  if (range) { sel.removeAllRanges(); sel.addRange(range); }

  document.execCommand(cmd, false, arg);
  queue(() => ({ html: serialise() }));
  positionFmt();
}

function buildFmtBar() {
  const b = (label, title, cmd, arg, cls = '') => h(`button.fmt__b${cls}`, {
    type: 'button', title,
    onmousedown: (ev) => ev.preventDefault(),
    onclick: () => exec(cmd, arg),
  }, label);
  return h('div.fmt', { hidden: true },
    b('B', 'Bold  ⌘B', 'bold'),
    b('I', 'Italic  ⌘I', 'italic', null, '.fmt__b--i'),
    b('U', 'Underline  ⌘U', 'underline', null, '.fmt__b--u'),
    h('span.fmt__sep'),
    b('H', 'Heading', 'formatBlock', 'h2'),
    b('h', 'Subheading', 'formatBlock', 'h3'),
    b('¶', 'Body', 'formatBlock', 'p'),
    h('span.fmt__sep'),
    b('•', 'Bullets', 'insertUnorderedList'),
    b('1.', 'Numbers', 'insertOrderedList'),
    b('❝', 'Quote', 'formatBlock', 'blockquote'));
}

function positionFmt() {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount || !docEl?.contains(sel.anchorNode)) {
    hideFmt();
    return;
  }
  if (!fmtBar) { fmtBar = buildFmtBar(); $('.overlays').appendChild(fmtBar); }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect.width && !rect.height) { hideFmt(); return; }

  fmtBar.hidden = false;
  const w = fmtBar.offsetWidth, ht = fmtBar.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, rect.left + rect.width / 2 - w / 2));
  let top = rect.top - ht - 8;
  if (top < 8) top = rect.bottom + 8;
  fmtBar.style.left = `${left}px`;
  fmtBar.style.top = `${top}px`;
}

function hideFmt() {
  if (fmtBar) fmtBar.hidden = true;
}

document.addEventListener('selectionchange', () => {
  if (!docEl || !isOpen()) return;
  const sel = getSelection();
  if (sel && !sel.isCollapsed && docEl.contains(sel.anchorNode)) positionFmt();
  else hideFmt();
});

/* ── source marks ─────────────────────────────────────────────────────── */

function onDocClick(ev) {
  const p = ev.target.closest?.('[data-qid]');
  if (!p || !docEl.contains(p)) return;
  const r = p.getBoundingClientRect();
  if (ev.clientX < r.right - 4) return;
  ev.preventDefault();
  go(`/browse/${p.dataset.qid}`);
}

/* ── keys ─────────────────────────────────────────────────────────────── */

function onKey(ev) {
  // Never let a keystroke meant for the note reach the page behind it.
  ev.stopPropagation();

  if (ev.metaKey || ev.ctrlKey) {
    const cmd = { b: 'bold', i: 'italic', u: 'underline' }[ev.key.toLowerCase()];
    if (cmd) { ev.preventDefault(); exec(cmd); }
    return;
  }

  if (ev.key === 'Escape') { hideFmt(); docEl.blur(); return; }

  if (ev.key !== 'Backspace') return;
  const sel = getSelection();
  if (!sel.isCollapsed || sel.anchorOffset !== 0) return;
  const prev = blockOf(sel.anchorNode)?.previousElementSibling;
  if (!prev?.classList.contains('doc-obj')) return;
  ev.preventDefault();
  const id = prev.dataset.clip;
  prev.remove();
  store.removeClip(activeNote().id, id);
  queue(() => ({ html: serialise() }));
}

/* ── notes ────────────────────────────────────────────────────────────── */

function newNote() {
  const note = store.createNote({ title: '' });
  store.setCaptureTarget(note.id);
  draw();
  requestAnimationFrame(() => {
    docEl?.focus();
    const r = document.createRange();
    r.selectNodeContents(docEl.firstElementChild);
    r.collapse(true);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
}

function switchNote() {
  const activeId = activeNote().id;
  const body = h('div.stack-16',
    store.state.notebooks.map((book) => {
      const notes = store.state.notes.filter((n) => n.book === book.id);
      return h('div.stack-6',
        h('div.row', { style: { gap: '8px' } },
          h('span.dot', { style: { background: book.color } }),
          h('span.label.grow', book.name)),
        notes.length
          ? h('div.stack-4', notes.slice(0, 40).map((n) => h('button.pick-row', {
            'aria-pressed': String(n.id === activeId),
            onclick: () => { store.setCaptureTarget(n.id); close(); draw(); },
          }, h('span.truncate.grow', noteTitle(n)))))
          : h('p.xs.muted', { style: { paddingLeft: '16px' } }, 'Empty'));
    }));

  const close = modal({
    title: 'Notes',
    desc: 'What is open here is also where clippings land.',
    body,
    actions: (dismiss) => [
      h('button.btn', {
        onclick: async () => {
          const name = await prompt({
            title: 'New notebook', label: 'Name',
            placeholder: 'e.g. Cardiology revision', ok: 'Create',
          });
          if (!name) return;
          const book = store.createNotebook(name);
          store.setCaptureTarget(store.createNote({ book: book.id, title: '' }).id);
          dismiss(); draw();
        },
      }, 'New notebook'),
      h('button.btn.btn--primary', { onclick: () => { dismiss(); newNote(); } }, 'New note'),
    ],
  });
}

function moreMenu() {
  const note = activeNote();
  const close = modal({
    title: noteTitle(note),
    body: h('div.stack-8',
      h('label.field',
        h('span.label', 'Notebook'),
        h('select.select', {
          onchange: (ev) => { persist({ book: ev.target.value }); draw(); },
        }, store.state.notebooks.map((b) => h('option', {
          value: b.id, selected: b.id === note.book,
        }, b.name)))),
      h('button.btn.btn--block', { onclick: () => { close(); go('/notebook'); } }, 'All notes'),
      h('button.btn.btn--block', { onclick: () => { close(); exportNote(note); } }, 'Export as Markdown')),
    actions: (dismiss) => [
      h('button.btn.btn--danger', {
        onclick: async () => {
          dismiss();
          const ok = await confirm({
            title: 'Delete this note?', desc: 'This cannot be undone.',
            ok: 'Delete', danger: true,
          });
          if (!ok) return;
          store.deleteNote(note.id);
          store.setCaptureTarget(store.state.notes[0]?.id || null);
          draw();
          toast('Note deleted');
        },
      }, 'Delete note'),
      h('button.btn.btn--primary', { onclick: dismiss }, 'Done'),
    ],
  });
}

/* ── export ───────────────────────────────────────────────────────────── */

export function noteToMarkdown(note) {
  const book = store.notebookById(note.book);
  const out = [`# ${noteTitle(note)}`, '',
    `*${book?.name || 'General'} · ${new Date(note.updated).toLocaleString()}*`, ''];

  const box = document.createElement('div');
  box.innerHTML = note.html || markdown(note.body || '');

  const inline = (el) => {
    let s = '';
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) { s += n.nodeValue; continue; }
      const t = n.tagName?.toLowerCase();
      const inner = inline(n);
      if (t === 'b' || t === 'strong') s += `**${inner}**`;
      else if (t === 'i' || t === 'em') s += `*${inner}*`;
      else if (t === 'br') s += '\n';
      else s += inner;
    }
    return s;
  };

  const emit = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.classList.contains('doc-obj')) {
      const c = note.clips.find((x) => x.id === el.dataset.clip);
      if (c?.kind === 'figure') out.push(`**${c.spec.title}**`, '', c.spec.caption, '');
      else if (c?.kind === 'table') {
        out.push(`**${c.spec.title}**`, '',
          `| ${c.spec.columns.join(' | ')} |`,
          `| ${c.spec.columns.map(() => '---').join(' | ')} |`);
        for (const r of c.spec.rows) out.push(`| ${r.join(' | ')} |`);
        out.push('');
      }
      return;
    }
    if (/^h[123]$/.test(tag)) { out.push(`${'#'.repeat(Number(tag[1]))} ${inline(el)}`, ''); return; }
    if (tag === 'ul' || tag === 'ol') {
      [...el.children].forEach((li, i) => out.push(`${tag === 'ul' ? '-' : `${i + 1}.`} ${inline(li)}`));
      out.push(''); return;
    }
    if (tag === 'blockquote') { out.push(`> ${inline(el)}`, ''); return; }
    if (tag === 'hr') { out.push('---', ''); return; }
    if (el.querySelector('ul, ol, h1, h2, h3')) { [...el.children].forEach(emit); return; }

    const text = inline(el).trim();
    if (!text) return;
    out.push(text);
    const src = el.getAttribute('data-src');
    if (src) out.push('', `<sub>${src}</sub>`);
    out.push('');
  };

  [...box.children].forEach(emit);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function exportNote(note) {
  const url = URL.createObjectURL(new Blob([noteToMarkdown(note)], { type: 'text/markdown;charset=utf-8' }));
  const a = h('a', { href: url, download: `${noteTitle(note).replace(/[^\w-]+/g, '-').toLowerCase()}.md` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Note exported');
}

/* ── resize ───────────────────────────────────────────────────────────── */

function startResize(ev) {
  ev.preventDefault();
  const startX = ev.clientX;
  const startW = store.prefs().panelWidth || 380;
  document.body.classList.add('resizing-panel');
  const width = (e) => Math.max(MIN_W, Math.min(MAX_W, startW + (startX - e.clientX)));

  const move = (e) => $('#app').style.setProperty('--panel-w', `${width(e)}px`);
  const up = (e) => {
    removeEventListener('pointermove', move);
    document.body.classList.remove('resizing-panel');
    store.setPref('panelWidth', width(e));
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up, { once: true });
}

export { meta, cat };
