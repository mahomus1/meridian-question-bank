/* Notes: the shelf, and a single note opened from it.

   The shelf holds notebooks you can open and close. Choosing a note gives it
   the whole page — the same editor the side panel uses, drawn full width. */

import { h, fill } from '../core/dom.js';
import * as store from '../core/store.js';
import { ago, n, stamp } from '../core/fmt.js';
import { htmlToText, excerpt } from '../render/prose.js';
import { prompt, modal, confirm, toast } from '../features/overlay.js';
import { go } from '../core/router.js';
import { noteTitle, exportNote, exportNotes, notebookSettings, mountNotePage, unmountNotePage, noteActions } from '../features/notepanel.js';
import { empty } from './parts.js';

export default async function notebook({ noteId }) {
  store.ensureNotebook();
  // A note opens as a page of its own. Showing it in a strip beside an
  // otherwise empty list is not opening it.
  if (noteId && store.noteById(noteId)) return notePage(noteId);

  let query = '';

  const el = h('div.wrap');
  const host = h('div.shelf.shelf--page');
  el.appendChild(host);

  const collapsed = () => new Set(store.prefs().collapsedBooks || []);
  const toggle = (id) => {
    const set = collapsed();
    if (set.has(id)) set.delete(id); else set.add(id);
    store.setPref('collapsedBooks', [...set]);
    draw();
  };

  const bodyText = (nt) => htmlToText(nt.html) || excerpt(nt.body) || '';

  /** Everything after the title, which the row shows on its own. */
  const preview = (nt) => {
    const full = bodyText(nt);
    const head = noteTitle(nt).replace(/…$/, '');
    const rest = full.startsWith(head) ? full.slice(head.length) : full;
    const text = rest.trim() || full.trim();
    if (text) return text.length > 120 ? `${text.slice(0, 120)}…` : text;
    return nt.clips.length ? 'A figure or table' : 'Empty';
  };

  /* While searching, the row shows the line that matched with the match
     itself marked — not the opening words of a note whose match is buried. */
  const previewNode = (nt) => {
    const q = query.trim().toLowerCase();
    if (q) {
      const hay = bodyText(nt);
      const i = hay.toLowerCase().indexOf(q);
      if (i >= 0) {
        let from = Math.max(0, i - 34);
        if (from > 0) {
          const sp = hay.indexOf(' ', from);
          if (sp > -1 && sp < i) from = sp + 1;
        }
        return [
          from > 0 ? '…' : '',
          hay.slice(from, i),
          h('mark.shelf__hit', hay.slice(i, i + q.length)),
          hay.slice(i + q.length, i + q.length + 110),
        ];
      }
    }
    return preview(nt);
  };

  // The notebook's own name counts as a match, so searching "renal" surfaces
  // everything filed under a notebook called that.
  const matches = (nt) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const book = store.notebookById(nt.book);
    return `${noteTitle(nt)} ${bodyText(nt)} ${book?.name || ''}`.toLowerCase().includes(q);
  };

  /* The note being dragged, kept here because dataTransfer is sealed during
     dragover and the drop target needs to know whether to light up. */
  let dragging = null;

  const noteRow = (nt, openId) => {
    const wrap = h('div.shelf__rowwrap', {
      draggable: 'true',
      ondragstart: (ev) => {
        dragging = nt.id;
        ev.dataTransfer.setData('text/plain', nt.id);
        ev.dataTransfer.effectAllowed = 'move';
        wrap.classList.add('is-dragging');
      },
      ondragend: () => {
        dragging = null;
        wrap.classList.remove('is-dragging');
        host.querySelectorAll('.shelf__book--drop')
          .forEach((s) => s.classList.remove('shelf__book--drop'));
      },
    },
      h('button.shelf__row', {
        'aria-current': String(nt.id === openId),
        onclick: () => go(`/notebook/${nt.id}`),
      },
        h('span.shelf__row-t.truncate', noteTitle(nt)),
        h('span.shelf__row-p.truncate', previewNode(nt)),
        h('span.shelf__row-d', ago(nt.updated))),
      h('button.shelf__more', {
        title: 'Note options', 'aria-label': `Options for ${noteTitle(nt)}`,
        onclick: () => noteOptions(nt),
      }, '···'));
    return wrap;
  };

  function draw() {
    const shut = collapsed();
    const openId = store.captureTarget()?.id;
    const searching = !!query.trim();
    const found = store.state.notes.filter(matches).length;

    fill(host,
      h('div.shelf__bar',
        h('div.search', { style: { width: '260px' } },
          h('input.input', {
            type: 'search', placeholder: 'Search all notes…', value: query,
            oninput: (ev) => { query = ev.target.value; draw(); },
          })),
        h('div.push.row', { style: { gap: '8px' } },
          h('button.btn.btn--sm', {
            onclick: async () => {
              const name = await prompt({
                title: 'New notebook', label: 'Name',
                placeholder: 'e.g. Cardiology revision', ok: 'Create',
              });
              if (!name) return;
              store.createNotebook(name);
              draw();
            },
          }, 'New notebook'),
          h('button.btn.btn--sm', { onclick: exportAll }, 'Export'),
          h('button.btn.btn--sm.btn--primary', {
            onclick: () => go(`/notebook/${store.createNote().id}`),
          }, 'New note'))),

      searching && !found
        ? empty({ mark: '⌕', title: 'No matching notes', text: 'Try a different search.' })
        : store.state.notebooks.map((book) => {
          const notes = store.state.notes
            .filter((x) => x.book === book.id && matches(x))
            .sort((a, b) => b.updated - a.updated);    // freshest work first
          // Searching should not make the reader open every notebook by hand.
          const isShut = searching ? false : shut.has(book.id);
          if (searching && !notes.length) return null;

          // A dropped row files its note here, wherever inside the book it
          // lands — on the head or between rows both read as "into this book".
          const section = h('section.shelf__book', {
            ondragover: (ev) => {
              if (!dragging) return;
              ev.preventDefault();
              ev.dataTransfer.dropEffect = 'move';
              section.classList.add('shelf__book--drop');
            },
            ondragleave: (ev) => {
              if (!section.contains(ev.relatedTarget)) section.classList.remove('shelf__book--drop');
            },
            ondrop: (ev) => {
              ev.preventDefault();
              section.classList.remove('shelf__book--drop');
              const id = dragging || ev.dataTransfer.getData('text/plain');
              dragging = null;
              const nt = store.noteById(id);
              if (!nt || nt.book === book.id) return;
              store.updateNote(id, { book: book.id });
              toast(`Moved to ${book.name}`);
            },
          },
            h('div.shelf__head',
              h('button.shelf__toggle', {
                'aria-expanded': String(!isShut),
                onclick: () => toggle(book.id),
              },
                h('span.shelf__chev'),
                h('span.dot', { style: { background: book.color } }),
                h('span.shelf__name.truncate', book.name),
                h('span.shelf__count', notes.length)),
              h('div.row', { style: { gap: '2px' } },
                h('button.shelf__more', {
                  title: 'Add a note here', 'aria-label': `New note in ${book.name}`,
                  onclick: () => go(`/notebook/${store.createNote({ book: book.id }).id}`),
                }, '+'),
                h('button.shelf__more', {
                  title: `${book.name} settings`, 'aria-label': `${book.name} settings`,
                  onclick: () => notebookSettings(book, draw),
                }, '···'))),

            isShut ? null : h('div.shelf__notes',
              notes.length
                ? notes.map((nt) => noteRow(nt, openId))
                : h('button.shelf__empty', {
                  onclick: () => go(`/notebook/${store.createNote({ book: book.id }).id}`),
                }, 'Add the first note')));
          return section;
        }));
  }

  /** File, open, export, or delete a note without opening it first. */
  function noteOptions(note) {
    const close = modal({
      title: noteTitle(note),
      desc: `Edited ${ago(note.updated)}`,
      body: h('div.stack-8',
        h('label.field',
          h('span.label', 'Notebook'),
          h('select.select', {
            onchange: (ev) => {
              store.updateNote(note.id, { book: ev.target.value });
              toast(`Moved to ${store.notebookById(ev.target.value)?.name || 'notebook'}`);
            },
          }, store.state.notebooks.map((b) => h('option', {
            value: b.id, selected: b.id === note.book,
          }, b.name)))),
        h('button.btn.btn--block', { onclick: () => { close(); go(`/notebook/${note.id}`); } }, 'Open note'),
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
            toast('Note deleted');
          },
        }, 'Delete note'),
        h('button.btn.btn--primary', { onclick: dismiss }, 'Done'),
      ],
    });
  }

  function exportAll() {
    exportNotes(store.state.notes.filter(matches), `meridian-notes-${stamp()}`);
  }

  draw();
  const offs = [
    store.on('notes', draw), store.on('notebooks', draw), store.on('capture', draw),
    // Opening a notebook in the panel's browser should not leave this page stale.
    store.on('prefs', (d) => { if (d?.k === 'collapsedBooks') draw(); }),
  ];

  const books = store.state.notebooks.length;
  return {
    title: 'Notes',
    subtitle: `${n(store.state.notes.length)} notes in ${n(books)} notebook${books === 1 ? '' : 's'}`,
    el,
    destroy() { offs.forEach((f) => f()); },
  };
}

/* ══ one note, full width ══════════════════════════════════════════════ */

function notePage(noteId) {
  const note = store.noteById(noteId);
  const el = h('div.panel.panel--page');

  /* Renaming a note should rename the page it is on. The editor writes the
     title straight to the store, so the heading follows from there rather than
     being redrawn — a redraw here would rebuild the editable under the caret.
     The footer already carries "Edited …", so the subtitle stays empty. */
  const off = store.on('notes', () => {
    const now = store.noteById(noteId);
    if (!now) return;
    const name = noteTitle(now);
    const head = document.querySelector('.topbar__title h1');
    if (head && head.textContent !== name) head.textContent = name;
    document.title = `${name} — Meridian`;
  });

  return {
    title: noteTitle(note),
    actions: [
      h('a.btn.btn--sm', { href: '#/notebook' }, '← Notes'),
      ...noteActions(note),
    ],
    el,
    fixed: true,
    ownsNotebook: true,
    mounted() { mountNotePage(el, noteId); },
    destroy() { off(); unmountNotePage(); },
  };
}
