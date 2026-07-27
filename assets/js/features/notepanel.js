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
import { buildDocx, download } from './docx.js';
import { figureSvg } from '../render/figure.js';
import { tableBlock } from '../render/table.js';
import { toast, confirm, prompt, modal } from './overlay.js';
import { enableBlockDrag } from './blockdrag.js';

let root = null;
let docEl = null;
let saveTimer = null;
let detachDrag = null;
let writing = false;        // true while the panel is saving its own edits

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
    onblur: rememberRange,
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

    toolbar(),

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

/* ── the toolbar ─────────────────────────────────────────────────────── */

/* Clicking a control moves focus out of the document, which collapses the
   selection the command needs. The last selection inside the note is kept and
   put back before anything runs. */
let savedRange = null;

function rememberRange() {
  const sel = getSelection();
  if (sel && sel.rangeCount && docEl?.contains(sel.anchorNode)) {
    savedRange = sel.getRangeAt(0).cloneRange();
  }
}

function restoreRange() {
  if (document.activeElement !== docEl) docEl.focus();
  if (!savedRange) return;
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange);
}

function exec(cmd, arg, { css = false } = {}) {
  restoreRange();
  try { document.execCommand('styleWithCSS', false, css); } catch { /* ignore */ }
  document.execCommand(cmd, false, arg);
  try { document.execCommand('styleWithCSS', false, false); } catch { /* ignore */ }
  rememberRange();
  queue(() => ({ html: serialise() }));
  syncToolbar();
}

const TEXT_COLORS = ['#101f33', '#14549c', '#126640', '#9e2f24', '#8a6212', '#6c7b8e'];
const MARK_COLORS = ['#fde68a', '#bfdbfe', '#bbf7d0', '#fbcfe8', '#e9d5ff'];

function swatchPop(anchor, colors, onPick, { clearLabel } = {}) {
  const pop = h('div.tb__pop',
    h('div.tb__swatches', colors.map((c) => h('button.tb__sw', {
      style: { background: c }, title: c,
      onmousedown: (ev) => ev.preventDefault(),
      onclick: () => { onPick(c); pop.remove(); },
    }))),
    clearLabel && h('button.tb__clear', {
      onmousedown: (ev) => ev.preventDefault(),
      onclick: () => { onPick(null); pop.remove(); },
    }, clearLabel));

  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(innerWidth - 190, r.left))}px`;
  pop.style.top = `${r.bottom + 6}px`;
  $('.overlays').appendChild(pop);

  const away = (ev) => {
    if (pop.contains(ev.target) || anchor.contains(ev.target)) return;
    pop.remove();
    document.removeEventListener('mousedown', away, true);
  };
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
}

const BLOCKS = [
  ['p', 'Body'], ['h1', 'Title'], ['h2', 'Heading'], ['h3', 'Subheading'],
  ['blockquote', 'Quote'], ['pre', 'Code block'],
];

let styleSelect = null;

function toolbar() {
  const b = (label, title, run, extra = '') => h(`button.tb__b${extra}`, {
    type: 'button', title,
    onmousedown: (ev) => ev.preventDefault(),
    onclick: run,
  }, label);
  const sep = () => h('span.tb__sep');

  styleSelect = h('select.tb__sel', {
    title: 'Paragraph style',
    onmousedown: rememberRange,
    onchange: (ev) => exec('formatBlock', ev.target.value),
  }, BLOCKS.map(([tag, name]) => h('option', { value: tag }, name)));

  return h('div.tb',
    b('↺', 'Undo  ⌘Z', () => exec('undo')),
    b('↻', 'Redo  ⇧⌘Z', () => exec('redo')),
    sep(),
    styleSelect,
    sep(),
    b('B', 'Bold  ⌘B', () => exec('bold'), '.tb__b--b'),
    b('I', 'Italic  ⌘I', () => exec('italic'), '.tb__b--i'),
    b('U', 'Underline  ⌘U', () => exec('underline'), '.tb__b--u'),
    b('S', 'Strikethrough', () => exec('strikeThrough'), '.tb__b--s'),
    sep(),
    h('button.tb__b', {
      type: 'button', title: 'Text colour',
      onmousedown: (ev) => { ev.preventDefault(); rememberRange(); },
      onclick: (ev) => swatchPop(ev.currentTarget, TEXT_COLORS,
        (c) => exec('foreColor', c || '#101f33', { css: true })),
    }, h('span.tb__ink', 'A')),
    h('button.tb__b', {
      type: 'button', title: 'Highlight',
      onmousedown: (ev) => { ev.preventDefault(); rememberRange(); },
      onclick: (ev) => swatchPop(ev.currentTarget, MARK_COLORS,
        (c) => exec('hiliteColor', c || 'transparent', { css: true }),
        { clearLabel: 'None' }),
    }, h('span.tb__mark', 'A')),
    sep(),
    b('•', 'Bulleted list', () => exec('insertUnorderedList')),
    b('1.', 'Numbered list', () => exec('insertOrderedList')),
    b('⇤', 'Outdent', () => exec('outdent')),
    b('⇥', 'Indent', () => exec('indent')),
    sep(),
    b('↤', 'Align left', () => exec('justifyLeft')),
    b('↔', 'Centre', () => exec('justifyCenter')),
    sep(),
    b('🔗', 'Link', addLink),
    b('⌫', 'Clear formatting', () => { exec('removeFormat'); exec('formatBlock', 'p'); }),
  );
}

async function addLink() {
  rememberRange();
  const sel = getSelection();
  if (!savedRange || savedRange.collapsed) { toast('Select the text to link first.'); return; }
  const url = await prompt({
    title: 'Link', label: 'Address', placeholder: 'https://…', ok: 'Add link',
  });
  if (!url) return;
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  exec('createLink', href);
  docEl.querySelectorAll('a[href]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  queue(() => ({ html: serialise() }));
}

/** Reflect the caret's paragraph style in the dropdown. */
function syncToolbar() {
  if (!styleSelect || !docEl) return;
  const sel = getSelection();
  if (!sel || !docEl.contains(sel.anchorNode)) return;
  const block = blockOf(sel.anchorNode);
  const tag = block?.tagName.toLowerCase();
  styleSelect.value = BLOCKS.some(([t]) => t === tag) ? tag : 'p';
}

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

  if (ev.key === 'Escape') { docEl.blur(); return; }

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
      h('button.btn.btn--block', { onclick: () => { close(); exportNote(note); } }, 'Export as Word (.docx)')),
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

export async function exportNote(note) {
  try {
    const blob = await buildDocx([note], { sources: store.prefs().showSources !== false });
    download(blob, `${fileName(noteTitle(note))}.docx`);
    toast('Exported as Word document');
  } catch (err) {
    console.error(err);
    toast('That note could not be exported.');
  }
}

export async function exportNotes(notes, name) {
  if (!notes.length) { toast('Nothing to export'); return; }
  try {
    const blob = await buildDocx(notes, { sources: store.prefs().showSources !== false });
    download(blob, `${name}.docx`);
    toast(`${notes.length} notes exported as Word`);
  } catch (err) {
    console.error(err);
    toast('The notebook could not be exported.');
  }
}

const fileName = (s2) => (s2 || 'note').replace(/[^\w\s-]+/g, '').trim()
  .replace(/\s+/g, '-').toLowerCase().slice(0, 60) || 'note';

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
