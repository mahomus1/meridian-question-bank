/* All notes.

   Writing happens in the side panel, so this page only has to help you find
   something and keep the notebooks tidy. */

import { h, fill } from '../core/dom.js';
import * as store from '../core/store.js';
import { ago, n, stamp } from '../core/fmt.js';
import { htmlToText, excerpt } from '../render/prose.js';
import { toast, confirm, prompt, modal } from '../features/overlay.js';
import { openNote, noteTitle, exportNotes } from '../features/notepanel.js';
import { empty } from './parts.js';

export default async function notebook({ noteId }) {
  store.ensureNotebook();
  if (noteId && store.noteById(noteId)) openNote(noteId);

  let book = 'all';
  let query = '';

  const el = h('div.wrap');
  const host = h('div.notes');
  el.appendChild(host);

  /** Everything after the title line, which the row shows separately. */
  const preview = (nt) => {
    const full = htmlToText(nt.html) || excerpt(nt.body) || '';
    const title = noteTitle(nt);
    const rest = full.startsWith(title.replace(/…$/, '')) ? full.slice(title.replace(/…$/, '').length) : full;
    const text = rest.trim();
    if (text) return text.length > 160 ? `${text.slice(0, 160)}…` : text;
    return nt.clips.length ? `${nt.clips.length} figure${nt.clips.length === 1 ? '' : 's'} or tables` : '';
  };

  function visible() {
    const q = query.trim().toLowerCase();
    return store.state.notes.filter((nt) => {
      if (book !== 'all' && nt.book !== book) return false;
      if (!q) return true;
      return `${noteTitle(nt)} ${htmlToText(nt.html) || nt.body} ${(nt.tags || []).join(' ')}`
        .toLowerCase().includes(q);
    });
  }

  function draw() {
    const notes = visible();
    const counts = {};
    for (const nt of store.state.notes) counts[nt.book] = (counts[nt.book] || 0) + 1;
    const openId = store.captureTarget()?.id;

    fill(host,
      /* notebooks along the top, not down the side — this page is a list */
      h('div.notes__bar',
        h('div.row.row--wrap', { style: { gap: '6px' } },
          h('button.chip', {
            'aria-pressed': String(book === 'all'),
            onclick: () => { book = 'all'; draw(); },
          }, 'All', h('span.chip__n', n(store.state.notes.length))),
          store.state.notebooks.map((b) => h('button.chip', {
            'aria-pressed': String(book === b.id),
            onclick: () => { book = b.id; draw(); },
            oncontextmenu: (ev) => { ev.preventDefault(); manage(b); },
          },
            h('span.chip__dot', { style: { background: b.color } }),
            b.name,
            h('span.chip__n', n(counts[b.id] || 0)),
            h('span.chip__gear', {
              title: `Manage ${b.name}`,
              onclick: (ev) => { ev.stopPropagation(); manage(b); },
            }, '···'))),
          h('button.chip.chip--add', {
            onclick: async () => {
              const name = await prompt({
                title: 'New notebook', label: 'Name',
                placeholder: 'e.g. Cardiology revision', ok: 'Create',
              });
              if (!name) return;
              book = store.createNotebook(name).id;
              draw();
            },
          }, '+ Notebook')),

        h('div.push.row', { style: { gap: '8px' } },
          h('div.search', { style: { width: '230px' } },
            h('input.input', {
              type: 'search', placeholder: 'Search notes…', value: query,
              oninput: (ev) => { query = ev.target.value; draw(); },
            })),
          h('button.btn.btn--sm', { onclick: exportAll }, 'Export all as Word'),
          h('button.btn.btn--sm.btn--primary', {
            onclick: () => {
              const nt = store.createNote({ book: book === 'all' ? undefined : book });
              openNote(nt.id);
              draw();
            },
          }, 'New note'))),

      notes.length
        ? h('div.notes__list', notes.map((nt) => {
          const bk = store.notebookById(nt.book);
          return h('button.note-row', {
            'aria-current': String(nt.id === openId),
            onclick: () => { openNote(nt.id); draw(); },
          },
            h('span.note-row__dot', { style: { background: bk?.color || 'var(--ink-4)' } }),
            h('span.note-row__t.truncate', noteTitle(nt)),
            h('span.note-row__p.truncate', preview(nt)),
            h('span.note-row__d', ago(nt.updated)));
        }))
        : empty({
          mark: '✎',
          title: query ? 'No matching notes' : 'No notes yet',
          text: query
            ? 'Try a different search.'
            : 'Open the notebook panel from any page and start writing, or highlight a passage in a question and send it across.',
          action: h('button.btn.btn--primary', {
            onclick: () => { const nt = store.createNote(); openNote(nt.id); draw(); },
          }, 'New note'),
        }));
  }

  function manage(bk) {
    const name = h('input.input', { type: 'text', value: bk.name });
    const count = store.state.notes.filter((x) => x.book === bk.id).length;

    modal({
      title: 'Notebook',
      desc: `${count} note${count === 1 ? '' : 's'}`,
      body: h('div.stack-16',
        h('label.field', h('span.label', 'Name'), name),
        h('div.field', h('span.label', 'Colour'),
          h('div.row.row--wrap', { style: { gap: '6px' } },
            store.BOOK_COLORS.map((c) => h('button.sw', {
              'aria-pressed': String(bk.color === c),
              style: { background: c },
              'aria-label': 'Set colour',
              onclick: (ev) => {
                store.updateNotebook(bk.id, { color: c });
                ev.currentTarget.parentElement.querySelectorAll('.sw')
                  .forEach((s) => s.setAttribute('aria-pressed', 'false'));
                ev.currentTarget.setAttribute('aria-pressed', 'true');
                draw();
              },
            }))))),
      actions: (close) => [
        store.state.notebooks.length > 1
          ? h('button.btn.btn--danger', {
            onclick: async () => {
              close();
              const ok = await confirm({
                title: `Delete “${bk.name}”?`,
                desc: count
                  ? `Its ${count} note${count === 1 ? '' : 's'} will move to ${store.state.notebooks.find((x) => x.id !== bk.id).name}.`
                  : 'This notebook is empty.',
                ok: 'Delete notebook', danger: true,
              });
              if (!ok) return;
              store.deleteNotebook(bk.id);
              if (book === bk.id) book = 'all';
              draw();
              toast('Notebook deleted');
            },
          }, 'Delete')
          : null,
        h('button.btn.btn--primary', {
          onclick: () => {
            if (name.value.trim()) store.renameNotebook(bk.id, name.value.trim());
            close(); draw();
          },
        }, 'Done'),
      ].filter(Boolean),
    });
  }

  function exportAll() {
    exportNotes(visible(), `meridian-notebook-${stamp()}`);
  }

  draw();
  const off = store.on('notes', draw);

  return {
    title: 'Notes',
    subtitle: `${n(store.state.notes.length)} notes · writing happens in the panel`,
    el,
    destroy() { off(); },
  };
}
