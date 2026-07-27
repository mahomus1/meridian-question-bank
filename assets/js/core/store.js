/* Persistent application state.
   Everything the reader creates — answers, tests, highlights, notes — lives in
   localStorage under one key. Writes are debounced; subscribers are notified by
   topic so views only re-render when something they care about changes. */

const KEY = 'meridian.v1';
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const BLANK = () => ({
  v: 1,
  profile: {
    since: Date.now(),
    prefs: {
      theme: 'auto',
      timerSecs: 90,
      showPeer: true,
      showRail: true,
      confirmSubmit: false,
      fontScale: 1,
    },
  },
  answers: {},     // qid -> { c, ok, ms, at, test }
  attempts: [],    // append-only log for trends
  marks: {},       // qid -> true
  tests: [],
  notebooks: [],
  notes: [],
  highlights: {},  // qid -> [{ id, b, s, e, c, note }]
  capture: { noteId: null },   // where clippings land until you change it
});

/** Muted palette for notebooks, so a shelf of them stays scannable. */
export const BOOK_COLORS = [
  '#4f7fd1', '#3f8f5f', '#c08a2a', '#b45445',
  '#8f6fd1', '#4fb0c6', '#d1608f', '#7a8ec9',
];

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return BLANK();
    const data = JSON.parse(raw);
    const base = BLANK();
    return {
      ...base, ...data,
      profile: { ...base.profile, ...data.profile, prefs: { ...base.profile.prefs, ...(data.profile?.prefs) } },
    };
  } catch {
    console.warn('Meridian: saved data unreadable, starting fresh.');
    return BLANK();
  }
}

export const state = load();

/* ── persistence ──────────────────────────────────────────────────────── */

let timer = null;
let quotaWarned = false;

export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 220);
}

export function flush() {
  clearTimeout(timer);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    if (!quotaWarned) {
      quotaWarned = true;
      emit('quota', err);
      console.error('Meridian: could not save — storage is full.', err);
    }
  }
}
addEventListener('beforeunload', flush);
addEventListener('pagehide', flush);

/* ── subscriptions ────────────────────────────────────────────────────── */

const subs = new Map();

export function on(topic, fn) {
  if (!subs.has(topic)) subs.set(topic, new Set());
  subs.get(topic).add(fn);
  return () => subs.get(topic).delete(fn);
}

export function emit(topic, payload) {
  subs.get(topic)?.forEach((fn) => fn(payload));
  if (topic !== '*') subs.get('*')?.forEach((fn) => fn(topic, payload));
}

function changed(topic, payload) { save(); emit(topic, payload); }

/* ── preferences ──────────────────────────────────────────────────────── */

export function setPref(k, v) {
  state.profile.prefs[k] = v;
  changed('prefs', { k, v });
}
export const prefs = () => state.profile.prefs;

/* ── answers ──────────────────────────────────────────────────────────── */

export function recordAnswer(qid, choice, ok, ms, testId) {
  state.answers[qid] = { c: choice, ok, ms, at: Date.now(), test: testId || null };
  state.attempts.push({ q: qid, c: choice, ok, ms, at: Date.now(), t: testId || null });
  if (state.attempts.length > 6000) state.attempts.splice(0, state.attempts.length - 6000);
  changed('answers', qid);
}

export const answerFor = (qid) => state.answers[qid] || null;

export function toggleMark(qid) {
  if (state.marks[qid]) delete state.marks[qid];
  else state.marks[qid] = true;
  changed('marks', qid);
  return !!state.marks[qid];
}
export const isMarked = (qid) => !!state.marks[qid];

export function resetProgress() {
  state.answers = {};
  state.attempts = [];
  state.marks = {};
  state.tests = [];
  changed('reset');
}

/* ── tests ────────────────────────────────────────────────────────────── */

export function createTest({ name, mode, timerSecs, qids, config }) {
  const test = {
    id: uid('t'),
    name,
    mode,                    // 'tutor' | 'timed'
    timerSecs: timerSecs || 0,
    qids,
    config,
    idx: 0,
    picks: {},               // qid -> letter
    locked: {},              // qid -> true once submitted (tutor mode)
    struck: {},              // qid -> [letters]
    spent: {},               // qid -> ms
    status: 'active',        // 'active' | 'done'
    startedAt: Date.now(),
    endedAt: null,
    elapsed: 0,
  };
  state.tests.unshift(test);
  changed('tests', test.id);
  return test;
}

export const testById = (id) => state.tests.find((t) => t.id === id) || null;

export function updateTest(id, patch) {
  const t = testById(id);
  if (!t) return null;
  Object.assign(t, patch);
  changed('tests', id);
  return t;
}

export function finishTest(id) {
  const t = testById(id);
  if (!t || t.status === 'done') return t;
  t.status = 'done';
  t.endedAt = Date.now();
  changed('tests', id);
  return t;
}

export function deleteTest(id) {
  const i = state.tests.findIndex((t) => t.id === id);
  if (i < 0) return;
  state.tests.splice(i, 1);
  changed('tests', id);
}

export const activeTest = () => state.tests.find((t) => t.status === 'active') || null;

/* ── notebooks & notes ────────────────────────────────────────────────── */

export function ensureNotebook() {
  if (!state.notebooks.length) {
    state.notebooks.push({
      id: uid('nb'), name: 'General', color: BOOK_COLORS[0], created: Date.now(),
    });
    save();
  }
  // Notebooks created before colours existed still need one.
  for (const [i, nb] of state.notebooks.entries()) {
    if (!nb.color) nb.color = BOOK_COLORS[i % BOOK_COLORS.length];
  }
  return state.notebooks[0];
}

export function createNotebook(name, color) {
  const nb = {
    id: uid('nb'),
    name: name || 'Untitled notebook',
    color: color || BOOK_COLORS[state.notebooks.length % BOOK_COLORS.length],
    created: Date.now(),
  };
  state.notebooks.push(nb);
  changed('notebooks', nb.id);
  return nb;
}

export function updateNotebook(id, patch) {
  const nb = state.notebooks.find((n) => n.id === id);
  if (!nb) return null;
  Object.assign(nb, patch);
  changed('notebooks', id);
  return nb;
}

export const renameNotebook = (id, name) => updateNotebook(id, { name });
export const notebookById = (id) => state.notebooks.find((n) => n.id === id) || null;

export function deleteNotebook(id) {
  if (state.notebooks.length <= 1) return false;
  state.notebooks = state.notebooks.filter((n) => n.id !== id);
  const fallback = state.notebooks[0].id;
  state.notes.forEach((n) => { if (n.book === id) n.book = fallback; });
  changed('notebooks', id);
  return true;
}

export function createNote(patch = {}) {
  const book = patch.book || ensureNotebook().id;
  const note = {
    id: uid('n'),
    book,
    title: patch.title || '',
    body: patch.body || '',
    tags: patch.tags || [],
    qid: patch.qid || null,
    clips: patch.clips || [],
    created: Date.now(),
    updated: Date.now(),
  };
  state.notes.unshift(note);
  changed('notes', note.id);
  return note;
}

export const noteById = (id) => state.notes.find((n) => n.id === id) || null;

export function updateNote(id, patch) {
  const n = noteById(id);
  if (!n) return null;
  Object.assign(n, patch, { updated: Date.now() });
  changed('notes', id);
  return n;
}

/* ── capture target ───────────────────────────────────────────────────── */

/** The note that clippings land in until the reader points it somewhere else. */
export function captureTarget() {
  const id = state.capture?.noteId;
  return id ? noteById(id) : null;
}

export function setCaptureTarget(noteId) {
  if (!state.capture) state.capture = { noteId: null };
  state.capture.noteId = noteId;
  changed('capture', noteId);
  return captureTarget();
}

export function deleteNote(id) {
  const i = state.notes.findIndex((n) => n.id === id);
  if (i < 0) return;
  if (state.capture?.noteId === id) state.capture.noteId = null;
  // Detach any highlight that pointed at this note.
  for (const list of Object.values(state.highlights)) {
    for (const hl of list) if (hl.note === id) delete hl.note;
  }
  state.notes.splice(i, 1);
  changed('notes', id);
}

export function addClip(noteId, clip) {
  const n = noteById(noteId);
  if (!n) return null;
  n.clips.push({ id: uid('c'), at: Date.now(), ...clip });
  n.updated = Date.now();
  changed('notes', noteId);
  return n;
}

export function removeClip(noteId, clipId) {
  const n = noteById(noteId);
  if (!n) return;
  n.clips = n.clips.filter((c) => c.id !== clipId);
  n.updated = Date.now();
  changed('notes', noteId);
}

export const notesFor = (qid) => state.notes.filter((n) => n.qid === qid
  || n.clips.some((c) => c.qid === qid));

/* ── highlights ───────────────────────────────────────────────────────── */

export function addHighlight(qid, { block, start, end, color }) {
  if (!state.highlights[qid]) state.highlights[qid] = [];
  const hl = { id: uid('h'), b: block, s: start, e: end, c: color };
  state.highlights[qid].push(hl);
  changed('highlights', qid);
  return hl;
}

export const highlightsFor = (qid) => state.highlights[qid] || [];

export function updateHighlight(qid, id, patch) {
  const hl = (state.highlights[qid] || []).find((x) => x.id === id);
  if (!hl) return null;
  Object.assign(hl, patch);
  changed('highlights', qid);
  return hl;
}

export function removeHighlight(qid, id) {
  if (!state.highlights[qid]) return;
  state.highlights[qid] = state.highlights[qid].filter((h) => h.id !== id);
  if (!state.highlights[qid].length) delete state.highlights[qid];
  changed('highlights', qid);
}

export const highlightCount = () => Object.values(state.highlights)
  .reduce((n, list) => n + list.length, 0);

/* ── derived statistics ───────────────────────────────────────────────── */

export function overall() {
  const vals = Object.values(state.answers);
  const done = vals.length;
  const right = vals.filter((a) => a.ok).length;
  const ms = vals.reduce((n, a) => n + (a.ms || 0), 0);
  return {
    done, right, wrong: done - right,
    pct: done ? Math.round((right / done) * 100) : 0,
    avgSec: done ? Math.round(ms / done / 1000) : 0,
    totalMs: ms,
  };
}

export function byCategory(index) {
  const out = {};
  for (const cat of index.categories) out[cat.slug] = { done: 0, right: 0, total: cat.count, peer: 0, peerN: 0 };
  for (const item of index.items) {
    const bucket = out[item.cat];
    if (!bucket) continue;
    bucket.peer += item.pct; bucket.peerN++;
    const a = state.answers[item.id];
    if (!a) continue;
    bucket.done++;
    if (a.ok) bucket.right++;
  }
  for (const b of Object.values(out)) {
    b.pct = b.done ? Math.round((b.right / b.done) * 100) : null;
    b.peerPct = b.peerN ? Math.round(b.peer / b.peerN) : 0;
  }
  return out;
}

export function byDifficulty(index) {
  const out = {};
  for (const item of index.items) {
    const b = out[item.diff] || (out[item.diff] = { done: 0, right: 0, total: 0 });
    b.total++;
    const a = state.answers[item.id];
    if (!a) continue;
    b.done++;
    if (a.ok) b.right++;
  }
  for (const b of Object.values(out)) b.pct = b.done ? Math.round((b.right / b.done) * 100) : null;
  return out;
}

/** Daily rollup over the last `days` days, oldest first. */
export function trend(days = 30) {
  const day = 864e5;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = today.getTime() - (days - 1) * day;
  const buckets = Array.from({ length: days }, (_, i) => ({
    at: start + i * day, done: 0, right: 0,
  }));
  for (const a of state.attempts) {
    if (a.at < start) continue;
    const i = Math.floor((a.at - start) / day);
    if (i < 0 || i >= days) continue;
    buckets[i].done++;
    if (a.ok) buckets[i].right++;
  }
  return buckets.map((b) => ({ ...b, pct: b.done ? Math.round((b.right / b.done) * 100) : null }));
}

/** Consecutive days ending today with at least one attempt. */
export function streak() {
  const day = 864e5;
  const seen = new Set(state.attempts.map((a) => {
    const d = new Date(a.at); d.setHours(0, 0, 0, 0); return d.getTime();
  }));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let n = 0, cursor = today.getTime();
  if (!seen.has(cursor)) cursor -= day;      // a streak survives until the day ends
  while (seen.has(cursor)) { n++; cursor -= day; }
  return n;
}

/* ── export / import ──────────────────────────────────────────────────── */

export function exportAll() {
  return JSON.stringify({ ...state, exported: new Date().toISOString() }, null, 2);
}

export function importAll(json) {
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object' || !('answers' in data)) {
    throw new Error('That file does not look like a Meridian backup.');
  }
  const base = BLANK();
  Object.assign(state, base, data, {
    profile: { ...base.profile, ...data.profile, prefs: { ...base.profile.prefs, ...(data.profile?.prefs) } },
  });
  flush();
  emit('reset');
}

export { uid };
