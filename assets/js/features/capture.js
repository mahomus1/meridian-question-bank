/* Sending things from a question into the notebook.

   There is nothing to configure: everything lands in the note that is open in
   the panel. Prose arrives as an ordinary paragraph carrying its origin, so it
   reads as writing rather than as an attachment. */

import * as store from '../core/store.js';
import { meta, cat } from '../core/bank.js';
import { toast } from './overlay.js';
import { activeNote, setOpen, draw, isOpen, insertAtCaret, noteTitle } from './notepanel.js';

/** Where the passage came from, in a form short enough for a margin. */
function sourceOf(qid, label) {
  const m = meta(qid);
  if (!m) return label || qid || '';
  return [label, m.topic, qid].filter(Boolean).join(' · ');
}

/** Place the block where the reader was writing, or at the end if elsewhere. */
function place(note, clip, what) {
  const built = store.buildClip(note.id, clip);
  if (!built) return null;

  const wasOpen = isOpen();
  if (!wasOpen) setOpen(true);          // opening draws the note

  if (!insertAtCaret(note.id, built.html)) {
    store.appendHtml(note.id, built.html);
    if (wasOpen) draw();
  }
  toast(`${what} → ${noteTitle(note)}`);
  return note;
}

export function clipText({ qid, text, source }) {
  const note = activeNote();
  return place(note, { kind: 'text', qid, text, source: sourceOf(qid, source) }, 'Passage');
}

/**
 * A passage from the library. It carries the topic rather than a question, so
 * the mark in the margin leads back to the reading it was taken from.
 */
export function clipPassage({ topicId, title, text, source }) {
  const note = activeNote();
  return place(note, {
    kind: 'text',
    topic: topicId,
    text,
    source: [source, title, 'Library'].filter(Boolean).join(' · '),
  }, 'Passage');
}

export function clipQuestion({ qid }) {
  const note = activeNote();
  const m = meta(qid);
  return place(note, {
    kind: 'text', qid,
    text: m ? `${m.topic} — ${m.ask}` : qid,
    source: sourceOf(qid, m?.archetypeLabel),
  }, 'Question');
}

export function clipFigure({ qid, spec }) {
  const note = activeNote();
  return place(note, { kind: 'figure', qid, spec, source: sourceOf(qid, 'Figure') }, 'Figure');
}

export function clipTable({ qid, spec }) {
  const note = activeNote();
  return place(note, { kind: 'table', qid, spec, source: sourceOf(qid, 'Table') }, 'Table');
}

export { activeNote, cat };
