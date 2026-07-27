/* Question bank access.
   The lightweight index loads at boot and drives every filter, count, and list.
   Full item bodies live in per-category files fetched on first use. */

import { state } from './store.js';

export const bank = {
  index: null,
  byId: new Map(),
  categories: new Map(),
  reference: null,
};

const loaded = new Map();   // slug -> Promise<Record<id, question>>
const bodies = new Map();   // id -> question

export async function loadIndex() {
  const res = await fetch('data/index.json');
  if (!res.ok) throw new Error(`Could not load the question index (${res.status}).`);
  const index = await res.json();
  bank.index = index;
  for (const item of index.items) bank.byId.set(item.id, item);
  for (const cat of index.categories) bank.categories.set(cat.slug, cat);
  return index;
}

export async function loadReference() {
  if (bank.reference) return bank.reference;
  const res = await fetch('data/reference.json');
  if (!res.ok) throw new Error('Could not load the reference values.');
  bank.reference = await res.json();
  return bank.reference;
}

export function loadCategory(slug) {
  if (loaded.has(slug)) return loaded.get(slug);
  const p = fetch(`data/questions/${slug}.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Could not load ${slug} (${r.status}).`);
      return r.json();
    })
    .then((obj) => {
      for (const [id, q] of Object.entries(obj)) bodies.set(id, q);
      return obj;
    })
    .catch((err) => { loaded.delete(slug); throw err; });
  loaded.set(slug, p);
  return p;
}

/** Full question body, fetching its category file if needed. */
export async function getQuestion(id) {
  if (bodies.has(id)) return bodies.get(id);
  const meta = bank.byId.get(id);
  if (!meta) throw new Error(`Unknown question ${id}.`);
  await loadCategory(meta.cat);
  const q = bodies.get(id);
  if (!q) throw new Error(`Question ${id} is missing from its category file.`);
  return q;
}

/** Warm the category files a test will need, so paging never stalls. */
export function prefetch(ids) {
  const slugs = new Set();
  for (const id of ids) {
    const meta = bank.byId.get(id);
    if (meta && !loaded.has(meta.cat)) slugs.add(meta.cat);
  }
  return Promise.all([...slugs].map((s) => loadCategory(s).catch(() => null)));
}

export const cat = (slug) => bank.categories.get(slug);
export const meta = (id) => bank.byId.get(id);

/* ── status & filtering ───────────────────────────────────────────────── */

/** 'correct' | 'incorrect' | 'unused'  (plus 'marked', tracked separately) */
export function statusOf(id) {
  const a = state.answers[id];
  if (!a) return 'unused';
  return a.ok ? 'correct' : 'incorrect';
}

export const POOLS = [
  { id: 'unused', label: 'Unused', hint: 'Never answered' },
  { id: 'incorrect', label: 'Incorrect', hint: 'Answered wrongly' },
  { id: 'correct', label: 'Correct', hint: 'Answered correctly' },
  { id: 'marked', label: 'Marked', hint: 'Flagged for review' },
  { id: 'all', label: 'All', hint: 'Entire bank' },
];

/**
 * Filter the index.
 * @param {{pools?:string[], cats?:string[], diffs?:string[], archetypes?:string[], query?:string}} f
 */
export function filterItems(f = {}) {
  const pools = f.pools?.length ? new Set(f.pools) : null;
  const cats = f.cats?.length ? new Set(f.cats) : null;
  const diffs = f.diffs?.length ? new Set(f.diffs) : null;
  const archs = f.archetypes?.length ? new Set(f.archetypes) : null;
  const q = f.query?.trim().toLowerCase();

  return bank.index.items.filter((it) => {
    if (cats && !cats.has(it.cat)) return false;
    if (diffs && !diffs.has(it.diff)) return false;
    if (archs && !archs.has(it.archetype)) return false;
    if (pools && !pools.has('all')) {
      const st = statusOf(it.id);
      const marked = !!state.marks[it.id];
      let hit = false;
      for (const p of pools) {
        if (p === 'marked' ? marked : st === p) { hit = true; break; }
      }
      if (!hit) return false;
    }
    if (q) {
      const hay = `${it.id} ${it.topic} ${it.ask} ${it.preview}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export const countItems = (f) => filterItems(f).length;

/** Deterministic shuffle when the reader asks for a shuffled test. */
export function pickQuestions(items, n, shuffle = true) {
  const list = items.slice();
  if (shuffle) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  return list.slice(0, n).map((it) => it.id);
}

export const bandLabel = (id) => bank.index.meta.bands.find((b) => b.id === id)?.label || id;
export const bandIndex = (id) => bank.index.meta.bands.findIndex((b) => b.id === id);
