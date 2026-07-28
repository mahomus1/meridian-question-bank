/* Notes: the shelf, and a single note opened from it.

   The shelf holds notebooks you can open and close. Choosing a note gives it
   the whole page — the same editor the side panel uses, drawn full width. */

import { h, fill } from '../core/dom.js';
import * as store from '../core/store.js';
import { ago, n, stamp } from '../core/fmt.js';
import { htmlToText, excerpt } from '../render/prose.js';
import { prompt } from '../features/overlay.js';
import { go } from '../core/router.js';
import { noteTitle, exportNotes, notebookSettings, mountNotePage, unmountNotePage, noteActions } from '../features/notepanel.js';
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

  /** Everything after the title, which the row shows on its own. */
  const preview = (nt) => {
    const full = htmlToText(nt.html) || excerpt(nt.body) || '';
    const head = noteTitle(nt).replace(/…$/, '');
    const rest = full.startsWith(head) ? full.slice(head.length) : full;
    const text = rest.trim() || full.trim();
    if (text) return text.length > 120 ? `${text.slice(0, 120)}…` : text;
    return nt.clips.length ? 'A figure or table' : 'Empty';
  };

  const matches = (nt) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${noteTitle(nt)} ${htmlToText(nt.html) || nt.body}`.toLowerCase().includes(q);
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
          const notes = store.state.notes.filter((x) => x.book === book.id && matches(x));
          // Searching should not make the reader open every notebook by hand.
          const isShut = searching ? false : shut.has(book.id);
          if (searching && !notes.length) return null;

          return h('section.shelf__book',
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
                ? notes.map((nt) => h('button.shelf__row', {
                  'aria-current': String(nt.id === openId),
                  onclick: () => go(`/notebook/${nt.id}`),
                },
                  h('span.shelf__row-t.truncate', noteTitle(nt)),
                  h('span.shelf__row-p.truncate', preview(nt)),
                  h('span.shelf__row-d', ago(nt.updated))))
                : h('button.shelf__empty', {
                  onclick: () => go(`/notebook/${store.createNote({ book: book.id }).id}`),
                }, 'Add the first note')));
        }));
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
