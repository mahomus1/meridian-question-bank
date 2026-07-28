/* Library access.

   The index loads at boot beside the question index and drives the contents
   list, search, and the link from a question to its topic. Full topic bodies
   live in per-chapter files fetched on first use, the same way question bodies
   do.

   A topic and a question topic are the same subject seen from two sides, so
   the index carries the question index's topic string and the two are matched
   on it rather than on a guessed slug. */

export const library = {
  index: null,
  byId: new Map(),          // topic id -> index entry
  chapters: new Map(),      // slug -> chapter
  byQuestionTopic: new Map(), // `${cat}|${topic}` -> topic id
};

const loaded = new Map();   // slug -> Promise
const docs = new Map();     // topic id -> full doc

export async function loadLibraryIndex() {
  const res = await fetch('data/library.json');
  if (!res.ok) throw new Error(`Could not load the library index (${res.status}).`);
  const index = await res.json();
  library.index = index;
  for (const ch of index.chapters) {
    library.chapters.set(ch.slug, ch);
    for (const t of ch.topics) {
      library.byId.set(t.id, t);
      library.byQuestionTopic.set(`${t.cat}|${t.topic}`, t.id);
    }
  }
  return index;
}

export function loadChapter(slug) {
  if (loaded.has(slug)) return loaded.get(slug);
  const p = fetch(`data/library/${slug}.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Could not load the ${slug} chapter (${r.status}).`);
      return r.json();
    })
    .then((obj) => {
      for (const [id, doc] of Object.entries(obj)) docs.set(id, doc);
      return obj;
    })
    .catch((err) => { loaded.delete(slug); throw err; });
  loaded.set(slug, p);
  return p;
}

/** Full topic body, fetching its chapter if needed. */
export async function getTopic(id) {
  if (docs.has(id)) return docs.get(id);
  const entry = library.byId.get(id);
  if (!entry) throw new Error(`Unknown topic ${id}.`);
  await loadChapter(entry.cat);
  const doc = docs.get(id);
  if (!doc) throw new Error(`Topic ${id} is missing from its chapter file.`);
  return doc;
}

export const topicMeta = (id) => library.byId.get(id) || null;
export const chapter = (slug) => library.chapters.get(slug) || null;

/** The library topic covering a question, or null when there is none. */
export function topicForQuestion(qMeta) {
  if (!qMeta) return null;
  const id = library.byQuestionTopic.get(`${qMeta.cat}|${qMeta.topic}`);
  return id ? library.byId.get(id) : null;
}

/** Which section a question archetype examines, e.g. 'mgmt' -> 'management'. */
export function sectionForArchetype(archetype) {
  const secs = library.index?.meta.sections || [];
  return secs.find((s) => s.archetype === archetype)?.id || null;
}

/** Search titles and summaries; cheap enough to run on every keystroke. */
export function searchTopics(query, limit = 40) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const t of library.byId.values()) {
    if (out.length >= limit) break;
    const hay = `${t.title} ${t.blurb}`.toLowerCase();
    if (hay.includes(q)) out.push(t);
  }
  // A title match is what the reader meant; summary matches follow.
  return out.sort((a, b) => {
    const at = a.title.toLowerCase().includes(q) ? 0 : 1;
    const bt = b.title.toLowerCase().includes(q) ? 0 : 1;
    return at - bt || a.title.localeCompare(b.title);
  });
}

/* ── highlight addressing ─────────────────────────────────────────────── */

/* Library highlights share the store with question highlights, so their key
   has to be unmistakably not a question id. */
export const LIB = 'lib:';
export const highlightKey = (topicId) => `${LIB}${topicId}`;
export const isLibraryKey = (key) => String(key).startsWith(LIB);
export const topicIdFromKey = (key) => String(key).slice(LIB.length);

/** Map every highlightable block in a topic to its text, in reading order. */
export function topicBlocks(doc) {
  const out = {};
  out.summary = doc.summary;
  for (const s of doc.sections) {
    s.paras.forEach((p, i) => { out[`${s.id}.${i}`] = p; });
  }
  return out;
}

/** The section a block id belongs to, for naming where a passage came from. */
export function blockSection(doc, blockId) {
  if (blockId === 'summary') return { id: 'summary', heading: 'Summary' };
  const secId = String(blockId).split('.')[0];
  return doc.sections.find((s) => s.id === secId) || null;
}
