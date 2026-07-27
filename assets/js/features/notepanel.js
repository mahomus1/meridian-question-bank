/* The notebook, as an editor beside the page.

   One panel, open on any view, holding one note at a time. What is open in the
   panel is also where clippings land — so there is nothing to configure and
   never a question about where something went.

   The document is plain: a clipped passage is an ordinary paragraph in the same
   face as everything else, carrying its origin as an attribute. A small mark in
   the margin is the only trace, and that can be switched off. */

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

const MIN_W = 300;
const MAX_W = 720;

/* ── the note the panel is showing ────────────────────────────────────── */

/** The open note, created on first use. Also the destination for clippings. */
export function activeNote() {
  const pinned = store.captureTarget();
  if (pinned) return pinned;
  const first = store.state.notes[0];
  if (first) { store.setCaptureTarget(first.id); return first; }
  const note = store.createNote({ title: 'Notes' });
  store.setCaptureTarget(note.id);
  return note;
}

export function openNote(id) {
  store.setCaptureTarget(id);
  setOpen(true);
  draw();
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
  const open = isOpen();
  app.classList.toggle('app--panel', open);
  app.style.setProperty('--panel-w', `${store.prefs().panelWidth || 380}px`);
  if (root) root.hidden = !open;
  $('[data-panel-toggle]')?.setAttribute('aria-pressed', String(open));
}

/* ── mount ────────────────────────────────────────────────────────────── */

export function mount() {
  root = h('aside.panel', { hidden: !isOpen(), 'aria-label': 'Notebook' });
  $('#app')?.appendChild(root);
  apply();
  if (isOpen()) draw();

  // Keep the panel honest when clippings arrive from elsewhere.
  store.on('notes', (id) => {
    if (isOpen() && id === activeNote().id) draw({ keepCaret: false });
  });
  store.on('capture', () => { if (isOpen()) draw(); });
  return root;
}

/* ── drawing ──────────────────────────────────────────────────────────── */

export function draw() {
  if (!root || !isOpen()) return;
  const note = activeNote();
  const book = store.notebookById(note.book);

  const title = h('input.panel__title', {
    type: 'text', value: note.title, placeholder: 'Untitled note',
    'aria-label': 'Note title',
    oninput: () => queue(() => ({ title: title.value })),
    onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); focusEnd(); } },
  });

  docEl = h('div.doc', {
    contenteditable: 'true', spellcheck: 'true',
    role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Note',
    dataset: { sources: store.prefs().showSources === false ? 'off' : 'on' },
    html: note.html || '<p><br></p>',
    oninput: () => { markEmpty(); queue(() => ({ html: serialise() })); },
    onkeydown: onKey,
    onclick: onDocClick,
    onpaste: (ev) => {
      ev.preventDefault();
      document.execCommand('insertText', false, ev.clipboardData.getData('text/plain'));
    },
  });

  fill(root,
    h('div.panel__grip', { title: 'Drag to resize', onpointerdown: startResize }),

    h('header.panel__head',
      h('button.panel__book', {
        title: 'Switch or create a note',
        onclick: switchNote,
      },
        h('span.dot', { style: { background: book?.color || 'var(--ink-4)' } }),
        h('span.truncate', book?.name || 'General'),
        h('span.dest__chev', '▾')),
      h('div.push.row', { style: { gap: '2px' } },
        h('button.panel__ico', { title: 'New note', 'aria-label': 'New note', onclick: newNote }, '+'),
        h('button.panel__ico', { title: 'More', 'aria-label': 'More', onclick: moreMenu }, '···'),
        h('button.panel__ico', { title: 'Close  ⌘J', 'aria-label': 'Close notebook', onclick: () => setOpen(false) }, '✕'))),

    h('div.panel__body',
      h('div.panel__inner',
        title,
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
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* unsupported */ }

  detachDrag?.();
  detachDrag = enableBlockDrag(root.querySelector('.doc-wrap'), docEl, () => {
    clearTimeout(saveTimer);
    store.updateNote(note.id, { html: serialise() });
  });
}

/* ── document plumbing ────────────────────────────────────────────────── */

function queue(patch) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const note = activeNote();
    if (note) store.updateNote(note.id, patch());
  }, 350);
}

/** Store only the reference for placed objects, and keep the markup valid. */
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

/** Draw the figures and tables the document references. */
function hydrate(note) {
  for (const el of docEl.querySelectorAll('.doc-obj')) {
    const c = note.clips.find((x) => x.id === el.dataset.clip);
    if (!c) { el.remove(); continue; }
    el.setAttribute('contenteditable', 'false');
    fill(el, objectBlock(note, c));
  }
  guardEnds();
}

/** A placed object never sits at an end with nowhere to type beside it. */
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

function focusEnd() {
  guardEnds();
  const last = docEl.lastElementChild;
  const r = document.createRange();
  r.selectNodeContents(last); r.collapse(false);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  docEl.focus();
}

/* ── source marks ─────────────────────────────────────────────────────── */

/** The mark sits in the margin, so a click out there opens the item. */
function onDocClick(ev) {
  const p = ev.target.closest?.('[data-qid]');
  if (!p || !docEl.contains(p)) return;
  const r = p.getBoundingClientRect();
  if (ev.clientX < r.right - 4) return;      // inside the text: keep editing
  ev.preventDefault();
  go(`/browse/${p.dataset.qid}`);
}

/* ── keys ─────────────────────────────────────────────────────────────── */

function onKey(ev) {
  if (ev.metaKey || ev.ctrlKey) {
    const cmd = { b: 'bold', i: 'italic' }[ev.key.toLowerCase()];
    if (cmd) {
      ev.preventDefault();
      document.execCommand(cmd);
      queue(() => ({ html: serialise() }));
    }
    return;
  }
  if (ev.key !== 'Backspace') return;
  const sel = getSelection();
  if (!sel.isCollapsed || sel.anchorOffset !== 0) return;
  const block = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  const prev = block?.closest('.doc > *')?.previousElementSibling;
  if (!prev?.classList.contains('doc-obj')) return;
  ev.preventDefault();
  const id = prev.dataset.clip;
  prev.remove();
  store.removeClip(activeNote().id, id);
  queue(() => ({ html: serialise() }));
}

/* ── note switching ───────────────────────────────────────────────────── */

function newNote() {
  const note = store.createNote({ title: '' });
  store.setCaptureTarget(note.id);
  draw();
  root.querySelector('.panel__title')?.focus();
}

function switchNote() {
  const books = store.state.notebooks;
  const activeId = activeNote().id;

  const body = h('div.stack-16',
    books.map((book) => {
      const notes = store.state.notes.filter((n) => n.book === book.id);
      return h('div.stack-6',
        h('div.row', { style: { gap: '8px' } },
          h('span.dot', { style: { background: book.color } }),
          h('span.label.grow', book.name)),
        notes.length
          ? h('div.stack-4', notes.slice(0, 40).map((n) => h('button.pick-row', {
            'aria-pressed': String(n.id === activeId),
            onclick: () => { store.setCaptureTarget(n.id); close(); draw(); },
          }, h('span.truncate.grow', n.title || 'Untitled note'))))
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
          const note = store.createNote({ book: book.id, title: name });
          store.setCaptureTarget(note.id);
          dismiss(); draw();
        },
      }, 'New notebook'),
      h('button.btn.btn--primary', { onclick: () => { dismiss(); newNote(); } }, 'New note'),
    ],
  });
}

function moreMenu() {
  const note = activeNote();
  modal({
    title: note.title || 'Untitled note',
    body: h('div.stack-8',
      h('label.field',
        h('span.label', 'Notebook'),
        h('select.select', {
          onchange: (ev) => { store.updateNote(note.id, { book: ev.target.value }); draw(); },
        }, store.state.notebooks.map((b) => h('option', {
          value: b.id, selected: b.id === note.book,
        }, b.name)))),
      h('button.btn.btn--block', { onclick: () => { closeAll(); go('/notebook'); } }, 'All notes'),
      h('button.btn.btn--block', { onclick: () => { closeAll(); exportNote(note); } }, 'Export as Markdown')),
    actions: (close) => [
      h('button.btn.btn--danger', {
        onclick: async () => {
          close();
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
      h('button.btn.btn--primary', { onclick: close }, 'Done'),
    ],
  });
  function closeAll() { document.querySelector('#modal').hidden = true; }
}

/* ── export ───────────────────────────────────────────────────────────── */

export function noteToMarkdown(note) {
  const book = store.notebookById(note.book);
  const out = [`# ${note.title || 'Untitled note'}`, '',
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
    const src = el.getAttribute('data-src');
    const qid = el.getAttribute('data-qid');
    out.push(text);
    if (src || qid) out.push('', `<sub>${[src, qid].filter(Boolean).join(' · ')}</sub>`);
    out.push('');
  };

  [...box.children].forEach(emit);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function exportNote(note) {
  const text = noteToMarkdown(note);
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = h('a', { href: url, download: `${(note.title || 'note').replace(/[^\w-]+/g, '-').toLowerCase()}.md` });
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

  const move = (e) => {
    const w = Math.max(MIN_W, Math.min(MAX_W, startW + (startX - e.clientX)));
    $('#app').style.setProperty('--panel-w', `${w}px`);
  };
  const up = (e) => {
    removeEventListener('pointermove', move);
    document.body.classList.remove('resizing-panel');
    store.setPref('panelWidth', Math.max(MIN_W, Math.min(MAX_W, startW + (startX - e.clientX))));
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up, { once: true });
}

/* ── writing into the panel from elsewhere ────────────────────────────── */

/** Append a paragraph, opening the panel so the reader sees where it went. */
export function appendToNote(html) {
  const note = activeNote();
  note.html = `${note.html || ''}${html}`;
  store.updateNote(note.id, { html: note.html });
  if (isOpen()) draw();
}

export { meta, cat };
