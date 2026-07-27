/* Capture to notebook.

   Anything a reader can see in an item — a passage, a figure, a table, the
   whole question — can be sent to a note in one action. The default target is
   the note attached to the current question, created on first use so the fast
   path never asks a question. "Save to…" opens the picker for everything else. */

import { h } from '../core/dom.js';
import * as store from '../core/store.js';
import { meta } from '../core/bank.js';
import { toast, modal } from './overlay.js';
import { go } from '../core/router.js';

/** The note that collects clips for a question, created on demand. */
export function noteForQuestion(qid) {
  const existing = store.state.notes.find((n) => n.qid === qid);
  if (existing) return existing;
  const m = meta(qid);
  return store.createNote({
    qid,
    title: m ? `${m.topic} · ${qid}` : qid,
    body: '',
    tags: m ? [m.topic] : [],
  });
}

function confirmSaved(note, what) {
  toast(`${what} saved to “${note.title || 'Untitled note'}”`, {
    action: 'Open',
    onAction: () => go(`/notebook/${note.id}`),
  });
}

/* ── the four clip kinds ──────────────────────────────────────────────── */

export function clipText({ qid, text, source, color, noteId }) {
  const note = noteId ? store.noteById(noteId) : noteForQuestion(qid);
  if (!note) return null;
  store.addClip(note.id, { kind: 'text', qid, text, source, color });
  confirmSaved(note, 'Passage');
  return note;
}

export function clipFigure({ qid, spec, noteId }) {
  const note = noteId ? store.noteById(noteId) : noteForQuestion(qid);
  if (!note) return null;
  store.addClip(note.id, { kind: 'figure', qid, spec, source: spec.title });
  confirmSaved(note, 'Figure');
  return note;
}

export function clipTable({ qid, spec, noteId }) {
  const note = noteId ? store.noteById(noteId) : noteForQuestion(qid);
  if (!note) return null;
  store.addClip(note.id, { kind: 'table', qid, spec, source: spec.title });
  confirmSaved(note, 'Table');
  return note;
}

export function clipQuestion({ qid, noteId }) {
  const note = noteId ? store.noteById(noteId) : noteForQuestion(qid);
  if (!note) return null;
  const m = meta(qid);
  store.addClip(note.id, {
    kind: 'question', qid,
    source: m ? `${m.topic} — ${m.archetypeLabel}` : qid,
  });
  confirmSaved(note, 'Question');
  return note;
}

/* ── "Save to…" picker ────────────────────────────────────────────────── */

/**
 * Ask which note should receive a clip, then run `send(noteId)`.
 * @param {{qid:string, what:string, send:(noteId:string)=>void}} opts
 */
export function pickNote({ qid, what, send }) {
  const notes = store.state.notes.slice(0, 60);
  const books = Object.fromEntries(store.state.notebooks.map((b) => [b.id, b.name]));
  let selected = notes[0]?.id || null;

  const list = h('div.stack-4', { style: { maxHeight: '320px', overflowY: 'auto' } },
    notes.length
      ? notes.map((n) => h('button.nb-item', {
        type: 'button',
        'aria-current': String(n.id === selected),
        onclick: (ev) => {
          selected = n.id;
          ev.currentTarget.parentElement.querySelectorAll('.nb-item')
            .forEach((b) => b.setAttribute('aria-current', 'false'));
          ev.currentTarget.setAttribute('aria-current', 'true');
        },
      },
        h('div.nb-item__t', n.title || 'Untitled note'),
        h('div.nb-item__m',
          h('span', books[n.book] || 'General'),
          h('span', '·'),
          h('span', `${n.clips.length} clip${n.clips.length === 1 ? '' : 's'}`))))
      : h('p.muted.sm', 'No notes yet — create one below.'));

  modal({
    title: `Save ${what} to…`,
    desc: 'Choose an existing note, or start a new one.',
    body: list,
    actions: (close) => [
      h('button.btn', {
        onclick: () => {
          const note = store.createNote({
            qid,
            title: meta(qid) ? `${meta(qid).topic} · ${qid}` : 'New note',
          });
          close();
          send(note.id);
        },
      }, 'New note'),
      h('button.btn.btn--primary', {
        disabled: !selected,
        onclick: () => { close(); if (selected) send(selected); },
      }, 'Save'),
    ],
  });
}

/** Small action button used on figures, tables, and the item header. */
export function clipButton(label, onclick, { title } = {}) {
  return h('button.btn.btn--sm', {
    type: 'button', onclick, title: title || label,
  }, label);
}
