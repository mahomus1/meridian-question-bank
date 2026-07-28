// Builds the library: one textbook topic per entry in the question taxonomy.
//
// Emits data/library.json (the index, loaded at boot) and
// data/library/<slug>.json (full topic bodies, fetched per chapter on demand).
//
// The prose is placeholder material, assembled from the same topic fields the
// questions are built from so the two read as one body of work. Sections are
// deliberately aligned to the five question archetypes, which is what lets the
// reader show the bank's questions beside the passage they belong to.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/* ── deterministic randomness ─────────────────────────────────────────── */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x4c494252);          // "LIBR"
const pick = (a) => a[Math.floor(rand() * a.length)];
const chance = (p) => rand() < p;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const lower = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

const slugify = (s) => s.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ── section plan ─────────────────────────────────────────────────────── */

/* Each section names the question archetype that probes it, so a reader with
   "Questions" switched on sees the bank's items filed under the passage they
   examine rather than in one undifferentiated list at the end. */
const SECTIONS = [
  { id: 'overview', heading: 'Overview', archetype: null },
  { id: 'mechanism', heading: 'Mechanism', archetype: 'mech' },
  { id: 'presentation', heading: 'Clinical presentation', archetype: 'dx' },
  { id: 'examination', heading: 'Examination', archetype: 'find' },
  { id: 'diagnosis', heading: 'Diagnosis', archetype: 'test' },
  { id: 'management', heading: 'Management', archetype: 'mgmt' },
  { id: 'course', heading: 'Course and pitfalls', archetype: null },
];

/* ── sentence pools ───────────────────────────────────────────────────── */

const OPENERS = [
  (t) => `${cap(t.name)} is defined by ${t.pres}, arising from ${t.mech}.`,
  (t) => `The presentation that names ${lower(t.name)} is ${t.pres}; the process behind it is ${t.mech}.`,
  (t) => `${cap(t.name)} describes the clinical picture of ${t.pres} produced by ${t.mech}.`,
];

const FRAMING = [
  'The account that follows moves from the underlying process to the bedside picture, then to confirmation and initial treatment — the order in which the problem is usually met.',
  'This entry is arranged in the order the problem tends to be encountered: what drives it, how it appears, how it is confirmed, and what is done first.',
  'Sections below follow one conventional sequence — mechanism, presentation, confirmation, management — and each can be read on its own.',
];

const FREQUENCY = [
  'Reported frequency varies with the population studied and with the threshold chosen to define a case, so figures quoted in different sources are rarely directly comparable.',
  'Prevalence estimates depend heavily on the setting in which they were gathered; referral series and community series describe different populations.',
  'How often the problem is seen depends on where the counting is done, and case definitions have shifted enough over time that historical series need reading with care.',
];

const MECH_OPEN = [
  (t) => `The process at work is ${t.mech}.`,
  (t) => `What drives the picture is ${t.mech}.`,
  (t) => `At the centre of the problem is ${t.mech}.`,
];

/* Deliberately free of the mechanism phrase: the opening sentence has just
   named it, and repeating it in full reads as padding. */
const MECH_ELAB = [
  'Once that is established, the downstream findings follow in a predictable order, which is what makes the presentation recognisable at the bedside.',
  'Its consequences account for both the symptoms the patient reports and the signs found on examination.',
  'Tracing the picture back to that single process explains why the individual findings travel together rather than appearing in isolation.',
];

const MECH_TAIL = [
  'Compensatory responses mask the process early and fail late, which is why the interval between the first abnormality and the first symptom can be long.',
  'The rate at which the process develops matters as much as its extent: a gradual change is tolerated where an abrupt one of the same size is not.',
  'Reserve within the affected system means measurable derangement often precedes anything the patient notices.',
];

const PRES_ELAB = [
  (t) => `Patients most often describe ${t.pres}, and it is the tempo of that history — how quickly it arrived and whether it is progressing — that carries the diagnostic weight.`,
  (t) => `The history classically centres on ${t.pres}; what refines it is the time course rather than the severity at any one moment.`,
  (t) => `${cap(t.pres)} is the complaint that brings the patient in, and its evolution over days to weeks is the detail worth pinning down.`,
];

const PRES_TAIL = [
  'Presentations at the extremes of age are frequently less typical, and a normal early course does not exclude the diagnosis.',
  'Partial or atypical presentations are common enough that the absence of one expected feature should not close the question.',
  'Comorbid disease alters the picture, sometimes to the point that the usual pattern is unrecognisable.',
];

const EXAM_ELAB = [
  (t) => `Examination characteristically shows ${t.find}, which is the finding with the greatest discriminating value in this setting.`,
  (t) => `The sign to look for is ${t.find}; it is more specific than the rest of the examination and is worth eliciting carefully.`,
  (t) => `${cap(t.find)} is the examination finding that most reliably separates this from its closest mimics.`,
];

const EXAM_TAIL = [
  'A normal examination early in the course is common and does not argue meaningfully against the diagnosis.',
  'Findings are easier to elicit once the process is established, so an unrevealing first examination deserves repeating.',
  'Interobserver agreement for the classic signs is only moderate, which is a reason to weigh them alongside the history rather than above it.',
];

const DX_ELAB = [
  (t) => `${cap(t.test)} is the initial study, chosen because it confirms the diagnosis and separates it from the alternatives that present the same way.`,
  (t) => `Evaluation begins with ${t.test}, which answers the question directly rather than narrowing it by degrees.`,
  (t) => `The first investigation is ${t.test}; ordering it early avoids a sequence of tests that each exclude one possibility.`,
];

const DX_TAIL = [
  'Testing before the pre-test probability has been thought through produces results that are difficult to act on in either direction.',
  'A negative result is only as useful as the probability it was applied to, which is the argument for estimating that probability first.',
  'Incidental findings are common enough that the question being asked should be settled before the study is requested.',
];

const RX_ELAB = [
  (t) => `Initial management is ${t.rx}, directed at ${t.mech} rather than at the symptom alone.`,
  (t) => `Treatment begins with ${t.rx}; measures that relieve the presenting complaint without addressing ${t.mech} do not change the trajectory.`,
  (t) => `The first step is ${t.rx}, which is what alters the course rather than merely improving how the patient feels.`,
];

const RX_TAIL = [
  'Response is reassessed at a defined interval rather than continuously, so that a genuine trend can be told apart from day-to-day variation.',
  'Escalation is guided by the response to the first measure; changing several things at once makes the result impossible to attribute.',
  'The plan is revisited when the expected improvement does not arrive, and the diagnosis is reconsidered before therapy is intensified.',
];

const COURSE_TAIL = [
  'Follow-up intervals are set by how quickly the situation could change, not by convention alone.',
  'Most of the harm in this area comes from delayed recognition rather than from choosing the wrong treatment once the diagnosis is clear.',
  'Documenting the reasoning at the point of decision is what makes a later reassessment useful.',
];

const NOTICE = 'Sample content. This text is illustrative placeholder material written to demonstrate the reading experience, not clinical guidance.';

/* ── tables ───────────────────────────────────────────────────────────── */

function compareTable(topic, other) {
  return {
    type: 'table',
    title: `Distinguishing ${topic.name.toLowerCase()} from ${other.name.toLowerCase()}`,
    caption: 'The features that most reliably separate the two presentations.',
    columns: ['Feature', topic.name, other.name],
    rows: [
      ['Presentation', cap(topic.pres), cap(other.pres)],
      ['Examination', cap(topic.find), cap(other.find)],
      ['Initial study', cap(topic.test), cap(other.test)],
      ['Initial management', cap(topic.rx), cap(other.rx)],
      ['Underlying process', cap(topic.mech), cap(other.mech)],
    ],
    note: 'Comparison built from sample topic material.',
  };
}

function stepsTable(topic) {
  return {
    type: 'table',
    title: 'Sequence of initial management',
    caption: 'Order of operations once the diagnosis is suspected.',
    columns: ['Step', 'Action', 'Rationale'],
    rows: [
      ['1', 'Assess severity and stability', 'Sets the urgency and the setting of care.'],
      ['2', cap(topic.test), 'Establishes or excludes the working diagnosis.'],
      ['3', cap(topic.rx), 'Initial management once the diagnosis is established.'],
      ['4', 'Reassess at a defined interval', 'Confirms response and detects complications early.'],
    ],
    note: null,
  };
}

/* ── one topic ────────────────────────────────────────────────────────── */

function buildTopic(cat, topic, code, siblings) {
  const other = pick(siblings);
  const sections = [];

  const para = (...parts) => parts.filter(Boolean).join(' ');

  sections.push({
    id: 'overview',
    heading: 'Overview',
    paras: [
      para(pick(OPENERS)(topic), pick(FRAMING)),
      para(pick(FREQUENCY), `The teaching point most often attached to this topic is that ${lower(topic.teach)}`),
    ],
  });

  sections.push({
    id: 'mechanism',
    heading: 'Mechanism',
    paras: [
      para(pick(MECH_OPEN)(topic), pick(MECH_ELAB)),
      para(pick(MECH_TAIL), `Understanding this is what makes ${lower(topic.rx)} the rational first response rather than an arbitrary one.`),
    ],
  });

  sections.push({
    id: 'presentation',
    heading: 'Clinical presentation',
    paras: [
      pick(PRES_ELAB)(topic),
      para(pick(PRES_TAIL), `A history of ${topic.pres} in the right context is enough to bring the diagnosis to the front of the differential.`),
    ],
  });

  sections.push({
    id: 'examination',
    heading: 'Examination',
    paras: [
      pick(EXAM_ELAB)(topic),
      pick(EXAM_TAIL),
    ],
  });

  sections.push({
    id: 'diagnosis',
    heading: 'Diagnosis',
    paras: [
      pick(DX_ELAB)(topic),
      para(pick(DX_TAIL), `The alternative most often confused with it is ${lower(other.name)}, which is compared below.`),
    ],
    table: compareTable(topic, other),
  });

  sections.push({
    id: 'management',
    heading: 'Management',
    paras: [
      pick(RX_ELAB)(topic),
      pick(RX_TAIL),
    ],
    table: chance(0.55) ? stepsTable(topic) : null,
  });

  sections.push({
    id: 'course',
    heading: 'Course and pitfalls',
    paras: [
      para(`${cap(topic.teach)}`, pick(COURSE_TAIL)),
      `The commonest error is to act on the presentation before ${lower(topic.test)} has been considered, which commits the patient to a course chosen on incomplete grounds.`,
    ],
  });

  /* Each section states which archetype examines it, so the renderer can file
     the bank's questions under the passage they belong to without consulting a
     second table. Built from the plan, so ids and headings cannot drift. */
  const byId = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));

  return {
    id: `${code}-${slugify(topic.name)}`,
    cat: cat.slug,
    title: topic.name,
    topic: topic.name,                 // the question index's topic string
    summary: `${cap(topic.pres)} with ${topic.find} is the presentation that defines ${lower(topic.name)}. ${cap(topic.test)} confirms it, and ${lower(topic.rx)} is the initial management.`,
    sections: sections.map((s) => ({
      ...s,
      heading: byId[s.id]?.heading || s.heading,
      archetype: byId[s.id]?.archetype || null,
      table: s.table || null,
    })),
    keyPoints: [
      cap(topic.teach),
      `Look for ${topic.find} on examination.`,
      `${cap(topic.test)} is the initial study.`,
      `Begin with ${topic.rx}.`,
    ],
  };
}

/* ── build ────────────────────────────────────────────────────────────── */

export function writeLibrary(root, CATEGORIES, CODES, ABBR, BLURB) {
  const index = { meta: {}, chapters: [] };
  const byChapter = {};
  let total = 0;
  let words = 0;

  for (const cat of CATEGORIES) {
    const code = (CODES[cat.slug] || cat.slug.slice(0, 3)).toLowerCase();
    const docs = cat.topics.map((topic) => buildTopic(
      cat, topic, code, cat.topics.filter((t) => t.name !== topic.name),
    ));

    // Related reading stays inside the chapter, so a link never strands the
    // reader in a subject they were not studying. Taking the neighbours rather
    // than the first three gives every topic a different set.
    docs.forEach((doc, i) => {
      doc.related = [1, 2, 3]
        .map((step) => docs[(i + step) % docs.length])
        .filter((d) => d && d.id !== doc.id)
        .map((d) => d.id);
    });

    byChapter[cat.slug] = Object.fromEntries(docs.map((d) => [d.id, d]));
    index.chapters.push({
      slug: cat.slug,
      name: cat.name,
      abbr: ABBR[cat.slug],
      dot: cat.dot,
      blurb: BLURB[cat.slug],
      count: docs.length,
      topics: docs.map((d) => ({
        id: d.id,
        title: d.title,
        topic: d.topic,
        cat: d.cat,
        sections: d.sections.length,
        summary: d.summary,
      })),
    });
    total += docs.length;
    for (const d of docs) {
      for (const s of d.sections) for (const p of s.paras) words += p.split(/\s+/).length;
    }
  }

  index.meta = {
    name: 'Meridian Library',
    built: '2026-07-28',
    topics: total,
    chapters: index.chapters.length,
    words,
    // Which archetype each section is examined by, for the questions toggle.
    sections: SECTIONS.map((s) => ({ id: s.id, heading: s.heading, archetype: s.archetype })),
    notice: NOTICE,
  };

  mkdirSync(join(root, 'data', 'library'), { recursive: true });
  writeFileSync(join(root, 'data', 'library.json'), JSON.stringify(index));
  for (const [slug, chapter] of Object.entries(byChapter)) {
    writeFileSync(join(root, 'data', 'library', `${slug}.json`), JSON.stringify(chapter));
  }

  return { total, words, chapters: index.chapters.length };
}
