/* Capture to notebook.

   Anything visible in an item — a passage, a figure, a table, the whole
   question — goes to the notebook in one click. It lands in the *pinned
   destination*, which the reader picks and can see at all times, so a clipping
   is never filed somewhere they did not choose. Until one is pinned, the
   destination is a note for the current question, created on first use. */

import { h, fill } from '../core/dom.js';
import * as store from '../core/store.js';
import { meta } from '../core/bank.js';
import { toast, modal, prompt } from './overlay.js';
import { go } from '../core/router.js';

/** The note attached to a question, created on demand. */
export function noteForQuestion(qid) {
  const existing = store.state.notes.find((n) => n.qid === qid);
  if (existing) return existing;
  const m = meta(qid);
  return store.createNote({
    qid,
    title: m ? `${m.topic} · ${qid}` : qid,
    tags: m ? [m.topic] : [],
  });
}

/** Where a clipping from `qid` should go right now. */
export function targetNote(qid) {
  return store.captureTarget() || noteForQuestion(qid);
}

/** Human-readable description of the current destination. */
export function targetLabel(qid) {
  const pinned = store.captureTarget();
  const note = pinned || store.state.notes.find((n) => n.qid === qid) || null;
  const book = note ? store.notebookById(note.book) : null;
  return {
    note,
    book,
    pinned: !!pinned,
    title: note ? (note.title || 'Untitled note') : 'A note for this question',
    bookName: book ? book.name : 'General',
    color: book ? book.color : 'var(--ink-4)',
  };
}

function saved(note, what) {
  toast(`${what} → ${note.title || 'Untitled note'}`, {
    action: 'Open',
    onAction: () => go(`/notebook/${note.id}`),
  });
}

/* ── the four clip kinds ──────────────────────────────────────────────── */

export function clipText({ qid, text, source, color, noteId }) {
  const note = noteId ? store.noteById(noteId) : targetNote(qid);
  if (!note) return null;
  store.addClip(note.id, { kind: 'text', qid, text, source, color });
  saved(note, 'Passage');
  return note;
}

export function clipFigure({ qid, spec, noteId }) {
  const note = noteId ? store.noteById(noteId) : targetNote(qid);
  if (!note) return null;
  store.addClip(note.id, { kind: 'figure', qid, spec, source: spec.title });
  saved(note, 'Figure');
  return note;
}

export function clipTable({ qid, spec, noteId }) {
  const note = noteId ? store.noteById(noteId) : targetNote(qid);
  if (!note) return null;
  store.addClip(note.id, { kind: 'table', qid, spec, source: spec.title });
  saved(note, 'Table');
  return note;
}

export function clipQuestion({ qid, noteId }) {
  const note = noteId ? store.noteById(noteId) : targetNote(qid);
  if (!note) return null;
  const m = meta(qid);
  store.addClip(note.id, {
    kind: 'question', qid, source: m ? `${m.topic} — ${m.archetypeLabel}` : qid,
  });
  saved(note, 'Question');
  return note;
}

/** Append typed text to the destination without leaving the item. */
export function writeNote({ qid, text }) {
  const body = text.trim();
  if (!body) return null;
  const note = targetNote(qid);
  const stamp = meta(qid) ? `${meta(qid).topic} · ${qid}` : qid;
  note.body = note.body
    ? `${note.body}\n\n${body}\n\n> from ${stamp}`
    : `${body}\n\n> from ${stamp}`;
  store.updateNote(note.id, { body: note.body });
  toast(`Saved to ${note.title || 'Untitled note'}`, {
    action: 'Open', onAction: () => go(`/notebook/${note.id}`),
  });
  return note;
}

/* ── destination picker ───────────────────────────────────────────────── */

/**
 * Choose where clippings go. Pins the choice so subsequent captures follow it.
 * @param {{qid?:string, onPick?:(note)=>void}} opts
 */
export function chooseTarget({ qid, onPick } = {}) {
  let close;

  const draw = (box) => {
    const books = store.state.notebooks;
    const pinnedId = store.captureTarget()?.id || null;

    const pick = (note) => {
      store.setCaptureTarget(note.id);
      close?.();
      onPick?.(note);
      toast(`Clippings now go to “${note.title || 'Untitled note'}”`);
    };

    fill(box,
      h('div.stack-16',
        books.map((book) => {
          const notes = store.state.notes.filter((n) => n.book === book.id);
          return h('div.stack-6',
            h('div.row', { style: { gap: '8px' } },
              h('span.dot', { style: { background: book.color } }),
              h('span.label.grow', book.name),
              h('button.btn.btn--sm.btn--ghost', {
                onclick: async () => {
                  const title = await prompt({
                    title: 'New note', label: 'Title',
                    placeholder: 'e.g. Valve lesions', ok: 'Create',
                  });
                  if (title === undefined) return;
                  pick(store.createNote({ book: book.id, title: title || 'Untitled note' }));
                },
              }, '+ Note')),
            notes.length
              ? h('div.stack-4', notes.slice(0, 30).map((n) => h('button.pick-row', {
                type: 'button',
                'aria-pressed': String(n.id === pinnedId),
                onclick: () => pick(n),
              },
                h('span.truncate.grow', n.title || 'Untitled note'),
                h('small', `${n.clips.length} clip${n.clips.length === 1 ? '' : 's'}`))))
              : h('p.xs.muted', { style: { paddingLeft: '16px' } }, 'No notes in this notebook yet.'));
        })));
  };

  const body = h('div');
  draw(body);

  close = modal({
    title: 'Where should clippings go?',
    desc: 'Everything you save from a question lands here until you change it.',
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
          // A new notebook needs somewhere to put things; name it after the
          // notebook rather than leaving an "Untitled note" behind.
          const note = store.createNote({ book: book.id, title: name });
          store.setCaptureTarget(note.id);
          dismiss();
          onPick?.(note);
          toast(`Clippings now go to “${book.name}”`);
        },
      }, 'New notebook'),
      qid
        ? h('button.btn', {
          onclick: () => {
            store.setCaptureTarget(null);
            dismiss();
            onPick?.(null);
            toast('Clippings go to a note for each question');
          },
        }, 'Use per-question notes')
        : null,
      h('button.btn.btn--primary', { onclick: dismiss }, 'Done'),
    ].filter(Boolean),
  });

  return close;
}
