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
let lastBlock = null;       // the block the caret was last in, for placement

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
  return 'Untitled note';
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
    onblur: () => { rememberRange(); showCaretMark(); },
    onfocus: hideCaretMark,
    onmouseup: rememberRange,
    onkeyup: rememberRange,
    onpaste: (ev) => {
      ev.preventDefault();
      document.execCommand('insertText', false, ev.clipboardData.getData('text/plain'));
    },
  });

  const titleEl = h('input.note-title', {
    type: 'text',
    value: note.title || '',
    placeholder: 'Untitled note',
    'aria-label': 'Note title',
    oninput: () => queue(() => ({ title: titleEl.value })),
    onkeydown: (ev) => {
      if (ev.key === 'Enter' || ev.key === 'ArrowDown') { ev.preventDefault(); focusEnd(); }
    },
  });

  fill(root,
    h('div.panel__grip', { title: 'Drag to resize', onpointerdown: startResize }),

    h('header.panel__head',
      h('button.panel__book', { title: 'Browse notebooks and notes', onclick: browseNotes },
        h('span.dot', { style: { background: book?.color || 'var(--ink-4)' } }),
        h('span.truncate', book?.name || 'General'),
        h('span.dest__chev', '▾')),
      h('div.push.row', { style: { gap: '2px' } },
        h('button.panel__ico', { title: 'New note', 'aria-label': 'New note', onclick: newNote }, '+'),
        h('button.panel__ico', { title: 'Note options', 'aria-label': 'Note options', onclick: moreMenu }, '···'),
        h('button.panel__ico', { title: 'Close  ⌘J', 'aria-label': 'Close notebook', onclick: () => setOpen(false) }, '✕'))),

    toolbar(),

    h('div.panel__body',
      h('div.panel__inner',
        titleEl,
        h('div.doc-wrap', docEl))),

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

let pending = {};

/* The title and the document share one debounce. Replacing the callback would
   let whichever field changed last discard the other's edit, so the patches
   are merged instead. */
function queue(getPatch) {
  Object.assign(pending, getPatch());
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const patch = pending;
    pending = {};
    persist(patch);
  }, 400);
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
  if (!sel || !sel.rangeCount || !docEl?.contains(sel.anchorNode)) return;
  savedRange = sel.getRangeAt(0).cloneRange();
  // A Range goes stale the moment the document is rebuilt; the block it sat in
  // is a far more durable answer to "where was I".
  const blk = blockOf(sel.anchorNode);
  if (blk && blk.parentElement === docEl) lastBlock = blk;
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

function swatchPop(anchor, colors, onPick, { clearLabel, current } = {}) {
  const pop = h('div.tb__pop',
    h('div.tb__swatches', colors.map((c) => h('button.tb__sw', {
      style: { background: c }, title: c,
      'aria-pressed': String(c === current),
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

/* Word splits its colour buttons in two: the face reapplies whatever you chose
   last, and only the caret opens the palette. Opening the palette to pick the
   same yellow again is two presses for a decision already made. */
function colourControl({ title, colors, pref, fallback, glyphClass, cmd, off, clearLabel }) {
  const glyph = h(`span.${glyphClass}`, 'A');
  const chosen = () => store.prefs()[pref] || fallback;
  const paint = () => {
    if (glyphClass === 'tb__ink') glyph.style.borderBottomColor = chosen();
    else glyph.style.background = chosen();
  };
  const apply = (c) => exec(cmd, c, { css: true });

  const hold = (ev) => { ev.preventDefault(); rememberRange(); };

  const wrap = h('span.tb__split',
    h('button.tb__b.tb__split__face', {
      type: 'button', title: `${title} — apply the last colour`,
      onmousedown: hold,
      onclick: () => apply(chosen()),
    }, glyph),
    h('button.tb__b.tb__split__more', {
      type: 'button', title: `${title} — choose a colour`,
      'aria-label': `${title}: choose a colour`,
      onmousedown: hold,
      onclick: (ev) => swatchPop(ev.currentTarget.parentElement, colors, (c) => {
        if (c) { store.setPref(pref, c); paint(); }
        apply(c || off);
      }, { clearLabel, current: chosen() }),
    }));

  paint();
  return wrap;
}

/* Named for the Word styles they export as, so what you pick here is what you
   get in the .docx. The note has a title field of its own, so the document
   starts at Heading 1 rather than offering a second title. */
const BLOCKS = [
  ['p', 'Body'],
  ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'],
  ['blockquote', 'Quote'],
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
    colourControl({
      title: 'Text colour', colors: TEXT_COLORS, pref: 'inkColor',
      fallback: '#14549c', glyphClass: 'tb__ink', cmd: 'foreColor', off: '#101f33',
    }),
    colourControl({
      title: 'Highlight', colors: MARK_COLORS, pref: 'markColor',
      fallback: '#fde68a', glyphClass: 'tb__mark', cmd: 'hiliteColor',
      off: 'transparent', clearLabel: 'None',
    }),
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

/* ── placing a clipping ───────────────────────────────────────────────── */

/**
 * Put a block where the reader last had the caret. Returns false when the
 * panel cannot place it — the caller then falls back to the end of the note.
 */
export function insertAtCaret(noteId, html) {
  if (!isOpen() || !docEl || activeNote()?.id !== noteId) return false;

  // After the paragraph the caret was in, so the reader's place is kept. A
  // figure cannot hold a caret, so fall back to the nearest block that can.
  const typable = (el) => el && !el.classList.contains('doc-obj');
  let at = lastBlock && lastBlock.parentElement === docEl ? lastBlock : null;
  while (at && !typable(at)) at = at.nextElementSibling;
  if (!at) at = [...docEl.children].reverse().find(typable);
  if (!at) return false;

  /* Routed through execCommand rather than appending the nodes directly: the
     browser only records edits it performs itself, so a passage dropped in by
     hand would sit outside the undo stack and ⌘Z would skip straight past it
     to whatever was typed before.

     It has to go in as one command, or undoing one saved passage would take
     two presses. That rules out breaking the paragraph first, so the break
     rides along in the payload: dropped at the end of a written line the
     browser unwraps the first block and merges it inline, losing the block
     and its attribution, but an empty paragraph ahead of it absorbs that.
     The empty paragraph left behind at the end is where the caret lands, so
     the next passage arrives into an empty block and needs no spacer. */
  const TAIL = '<p><br></p>';
  const roomy = !at.textContent.trim() && !at.querySelector('.doc-obj');
  const payload = (roomy ? '' : TAIL) + (html.endsWith(TAIL) ? html : html + TAIL);

  docEl.focus();
  const caret = document.createRange();
  caret.selectNodeContents(at);
  caret.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(caret);

  const before = new Set(docEl.children);
  document.execCommand('insertHTML', false, payload);
  const added = [...docEl.children].filter((el) => !before.has(el));

  hydrate(activeNote());
  markEmpty();

  // Leave the caret after what was just placed, ready to keep writing.
  const last = added[added.length - 1] || docEl.lastElementChild;
  if (!last) return false;
  const r = document.createRange();
  r.selectNodeContents(last);
  r.collapse(false);
  savedRange = r;
  lastBlock = last.parentElement === docEl ? last : lastBlock;

  clearTimeout(saveTimer);
  persist({ html: serialise() });
  showCaretMark();
  last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return true;
}

/* ── where the caret was ──────────────────────────────────────────────── */

let caretMark = null;
let watcher = null;

/* Once the note loses focus the caret vanishes, and with it any sense of where
   the next saved passage will go. A quiet bar marks the block it was in —
   which is exactly the precision the insertion uses. */
function showCaretMark() {
  const wrap = root?.querySelector('.doc-wrap');
  if (!wrap || !docEl) return;
  if (!lastBlock || lastBlock.parentElement !== docEl) { hideCaretMark(); return; }

  // Redrawing the note builds a fresh wrap, orphaning the old bar.
  if (caretMark?.parentElement !== wrap) {
    watcher?.disconnect();
    caretMark = h('span.doc-caret', { title: 'Anything you save from a question goes here' });
    wrap.appendChild(caretMark);
    // A saved passage lands and reflows the note under the bar. Re-measuring on
    // every reflow keeps it on the block it names instead of a stale rectangle.
    watcher = new ResizeObserver(() => { if (caretMark?.classList.contains('on')) place(); });
    watcher.observe(docEl);
  }
  caretMark.classList.add('on');
  // Measured next frame: a block placed this tick has not been laid out yet.
  requestAnimationFrame(place);

  function place() {
    if (!lastBlock?.isConnected || lastBlock.parentElement !== docEl) return;
    const r = lastBlock.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    caretMark.style.top = `${r.top - wr.top}px`;
    caretMark.style.height = `${Math.max(18, r.height)}px`;
  }
}

function hideCaretMark() { caretMark?.classList.remove('on'); }

/* ── source marks ─────────────────────────────────────────────────────── */

/* The mark lives in the paragraph's right-hand gutter. Only a plain click
   landing in that gutter opens the question — a drag that happens to finish
   near the edge is a text selection, not a request to navigate away. */
function onDocClick(ev) {
  const p = ev.target.closest?.('[data-qid]');
  if (!p || !docEl.contains(p)) return;
  if (docEl.dataset.sources === 'off') return;

  const sel = getSelection();
  if (sel && !sel.isCollapsed) return;

  const gutter = parseFloat(getComputedStyle(p).paddingRight) || 0;
  if (!gutter) return;
  const r = p.getBoundingClientRect();
  if (ev.clientX < r.right - gutter) return;

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

  /* Splitting a paragraph copies its attributes onto the new one, so words
     typed after a clipped passage would inherit its attribution and be
     credited to a question the reader never quoted. A paragraph that comes
     out of the split empty is the reader's own, and loses the source. */
  if (ev.key === 'Enter') {
    const from = blockOf(getSelection().anchorNode);
    if (from?.dataset.src || from?.dataset.qid) {
      setTimeout(() => {
        const made = blockOf(getSelection().anchorNode);
        if (made && made !== from && !made.textContent.trim()) {
          delete made.dataset.src;
          delete made.dataset.qid;
          queue(() => ({ html: serialise() }));
        }
      }, 0);
    }
    return;
  }

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

/* ── browsing notebooks and notes ─────────────────────────────────────── */

const collapsed = () => new Set(store.prefs().collapsedBooks || []);
function toggleBook(id) {
  const set = collapsed();
  if (set.has(id)) set.delete(id); else set.add(id);
  store.setPref('collapsedBooks', [...set]);
}

/**
 * The notebook shelf: notebooks, each opening to reveal its notes. Built here
 * and on the Notes page from the same idea, so the structure reads the same
 * way in both places.
 */
function browseNotes() {
  let close;

  const body = h('div.shelf');

  const render = () => {
    const openId = activeNote()?.id;
    const shut = collapsed();

    fill(body, store.state.notebooks.map((book) => {
      const notes = store.state.notes.filter((n) => n.book === book.id);
      const isShut = shut.has(book.id);

      return h('section.shelf__book',
        h('div.shelf__head',
          h('button.shelf__toggle', {
            'aria-expanded': String(!isShut),
            title: isShut ? `Show ${book.name}` : `Hide ${book.name}`,
            onclick: () => { toggleBook(book.id); render(); },
          },
            h('span.shelf__chev'),
            h('span.dot', { style: { background: book.color } }),
            h('span.shelf__name.truncate', book.name),
            h('span.shelf__count', notes.length)),
          h('button.shelf__more', {
            title: `${book.name} settings`, 'aria-label': `${book.name} settings`,
            onclick: () => { close(); notebookSettings(book, () => browseNotes()); },
          }, '···')),

        isShut ? null : h('div.shelf__notes',
          notes.length
            ? notes.map((n) => h('button.shelf__note', {
              'aria-current': String(n.id === openId),
              onclick: () => { store.setCaptureTarget(n.id); close(); draw(); },
            },
              h('span.shelf__dot'),
              h('span.truncate.grow', noteTitle(n)),
              n.id === openId ? h('span.shelf__open', 'open') : null))
            : h('button.shelf__empty', {
              onclick: () => { const n = store.createNote({ book: book.id, title: '' }); close(); openNote(n.id); },
            }, 'Add the first note')));
    }));
  };
  render();

  close = modal({
    title: 'Notebooks',
    desc: 'Anything you save from a question goes into the note that is open.',
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
          dismiss();
          openNote(store.createNote({ book: book.id, title: '' }).id);
        },
      }, 'New notebook'),
      h('button.btn.btn--primary', { onclick: () => { dismiss(); newNote(); } }, 'New note'),
    ],
  });
}

/** Rename a notebook, recolour it, or remove it. */
export function notebookSettings(book, after) {
  const name = h('input.input', { type: 'text', value: book.name });
  let colour = book.color;
  const count = store.state.notes.filter((x) => x.book === book.id).length;

  const swatches = h('div.row.row--wrap', { style: { gap: '6px' } },
    store.BOOK_COLORS.map((c) => h('button.sw', {
      'aria-pressed': String(colour === c),
      style: { background: c },
      'aria-label': 'Set colour',
      onclick: (ev) => {
        colour = c;
        ev.currentTarget.parentElement.querySelectorAll('.sw')
          .forEach((x) => x.setAttribute('aria-pressed', 'false'));
        ev.currentTarget.setAttribute('aria-pressed', 'true');
      },
    })));

  modal({
    title: 'Notebook',
    desc: `${count} note${count === 1 ? '' : 's'}`,
    body: h('div.stack-16',
      h('label.field', h('span.label', 'Name'), name),
      h('div.field', h('span.label', 'Colour'), swatches)),
    actions: (close) => [
      store.state.notebooks.length > 1
        ? h('button.btn.btn--danger', {
          onclick: async () => {
            close();
            const ok = await confirm({
              title: `Delete “${book.name}”?`,
              desc: count
                ? `Its ${count} note${count === 1 ? '' : 's'} move to ${store.state.notebooks.find((x) => x.id !== book.id).name}.`
                : 'This notebook is empty.',
              ok: 'Delete notebook', danger: true,
            });
            if (!ok) { after?.(); return; }
            store.deleteNotebook(book.id);
            draw();
            after?.();
            toast('Notebook deleted');
          },
        }, 'Delete')
        : null,
      h('button.btn.btn--primary', {
        onclick: () => {
          store.updateNotebook(book.id, {
            name: name.value.trim() || book.name,
            color: colour,
          });
          close();
          draw();
          after?.();
        },
      }, 'Done'),
    ].filter(Boolean),
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
      h('button.btn.btn--block', {
        onclick: () => { close(); notebookSettings(store.notebookById(note.book)); },
      }, 'Notebook settings'),
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

const REF_MODES = [
  ['list', 'A numbered list at the end',
    'Each quoted passage gets a small superscript number, and the questions are listed once under “Sources”.'],
  ['inline', 'A line under each passage',
    'The question is named beneath the passage it came from, and repeated sources are named once.'],
  ['none', 'Leave them out',
    'Nothing marks where a passage came from.'],
];

/** Ask how references should appear, then write the file. */
function exportWith(notes, filename) {
  if (!notes.length) { toast('Nothing to export'); return; }
  let mode = store.prefs().exportRefs || 'list';

  const options = h('div.stack-6', REF_MODES.map(([id, name, desc]) => h('button.pick-card', {
    type: 'button',
    'aria-pressed': String(mode === id),
    onclick: (ev) => {
      mode = id;
      ev.currentTarget.parentElement.querySelectorAll('.pick-card')
        .forEach((c) => c.setAttribute('aria-pressed', 'false'));
      ev.currentTarget.setAttribute('aria-pressed', 'true');
    },
  }, h('b', name), h('span', desc))));

  modal({
    title: 'Export to Word',
    desc: `${notes.length === 1 ? 'This note' : `${notes.length} notes`} as a .docx file.`,
    body: h('div.stack-12', h('span.label', 'Question references'), options),
    actions: (close) => [
      h('button.btn', { onclick: close }, 'Cancel'),
      h('button.btn.btn--primary', {
        onclick: async (ev) => {
          const btn = ev.currentTarget;
          btn.disabled = true;
          btn.textContent = 'Building…';
          store.setPref('exportRefs', mode);
          try {
            const blob = await buildDocx(notes, { refs: mode });
            download(blob, `${filename}.docx`);
            close();
            toast(notes.length === 1 ? 'Exported as Word' : `${notes.length} notes exported`);
          } catch (err) {
            console.error(err);
            btn.disabled = false;
            btn.textContent = 'Export';
            toast('That could not be exported.');
          }
        },
      }, 'Export'),
    ],
  });
}

export function exportNote(note) {
  exportWith([note], fileName(noteTitle(note)));
}

export function exportNotes(notes, name) {
  exportWith(notes, name);
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
