/* Sending things from a question into the notebook.

   There is nothing to configure: everything lands in the note that is open in
   the panel. Prose arrives as an ordinary paragraph carrying its origin, so it
   reads as writing rather than as an attachment. */

import * as store from '../core/store.js';
import { meta, cat } from '../core/bank.js';
import { toast } from './overlay.js';
import { activeNote, setOpen, draw, isOpen } from './notepanel.js';

/** Where the passage came from, in a form short enough for a margin. */
function sourceOf(qid, label) {
  const m = meta(qid);
  if (!m) return label || qid || '';
  return [label, m.topic, qid].filter(Boolean).join(' · ');
}

function landed(what) {
  const note = activeNote();
  if (!isOpen()) setOpen(true); else draw();
  toast(`${what} → ${note.title || 'Untitled note'}`);
  return note;
}

export function clipText({ qid, text, source }) {
  const note = activeNote();
  store.addClip(note.id, { kind: 'text', qid, text, source: sourceOf(qid, source) });
  return landed('Passage');
}

export function clipQuestion({ qid }) {
  const note = activeNote();
  const m = meta(qid);
  store.addClip(note.id, {
    kind: 'text', qid,
    text: m ? `${m.topic} — ${m.ask}` : qid,
    source: sourceOf(qid, m?.archetypeLabel),
  });
  return landed('Question');
}

export function clipFigure({ qid, spec }) {
  const note = activeNote();
  store.addClip(note.id, { kind: 'figure', qid, spec, source: sourceOf(qid, 'Figure') });
  return landed('Figure');
}

export function clipTable({ qid, spec }) {
  const note = activeNote();
  store.addClip(note.id, { kind: 'table', qid, spec, source: sourceOf(qid, 'Table') });
  return landed('Table');
}

export { activeNote, cat };
