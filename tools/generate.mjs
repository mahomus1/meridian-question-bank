// Meridian — question bank builder.
//
// Emits data/index.json (light, loaded at boot) and data/questions/<slug>.json
// (full item bodies, loaded on demand). All clinical detail is illustrative
// sample material built from a fixed topic taxonomy — structurally faithful to
// board-style items, not a source of clinical guidance.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import CATEGORIES from './content/topics.mjs';
import { writeLibrary } from './library.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_PER_CATEGORY = 100;

/* ── deterministic randomness ─────────────────────────────────────────── */

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x4d455249);
const ri = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const rf = (min, max) => rand() * (max - min) + min;
const pick = (a) => a[Math.floor(rand() * a.length)];
const chance = (p) => rand() < p;
const shuffle = (a) => {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
};
const sample = (a, n) => shuffle(a).slice(0, n);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ── category metadata ────────────────────────────────────────────────── */

const CODES = {
  cardiology: 'CAR', pulmonology: 'PUL', gastroenterology: 'GAS',
  nephrology: 'NEP', endocrinology: 'END', 'infectious-disease': 'INF',
  neurology: 'NEU', 'hematology-oncology': 'HEM', rheumatology: 'RHE',
  psychiatry: 'PSY',
};
const ABBR = {
  cardiology: 'Cardio', pulmonology: 'Pulm', gastroenterology: 'GI',
  nephrology: 'Renal', endocrinology: 'Endo', 'infectious-disease': 'ID',
  neurology: 'Neuro', 'hematology-oncology': 'Heme/Onc', rheumatology: 'Rheum',
  psychiatry: 'Psych',
};
const BLURB = {
  cardiology: 'Ischemic disease, valvular lesions, rhythm disturbance, and vascular emergencies.',
  pulmonology: 'Airway disease, parenchymal and pleural disorders, and respiratory failure.',
  gastroenterology: 'Luminal disease, pancreaticobiliary disorders, and liver medicine.',
  nephrology: 'Acute and chronic kidney disease, electrolytes, and acid–base.',
  endocrinology: 'Glycemic disorders, thyroid and adrenal disease, and bone metabolism.',
  'infectious-disease': 'Community and healthcare-associated infection, and the febrile patient.',
  neurology: 'Cerebrovascular disease, headache, movement disorders, and neuromuscular illness.',
  'hematology-oncology': 'Anemias, cytopenias, hematologic malignancy, and oncologic emergencies.',
  rheumatology: 'Inflammatory arthritis, connective tissue disease, and the vasculitides.',
  psychiatry: 'Mood, anxiety, psychotic, and substance use disorders in the medical setting.',
};

/* ── clinical texture pools ───────────────────────────────────────────── */

// Where a patient is seen has to match how quickly they got there, or the
// vignette contradicts itself.
const SETTINGS = {
  emergent: [
    'is evaluated in the emergency department',
    'is brought to the emergency department',
    'is admitted to the hospital',
    'is evaluated in the emergency department by the on-call team',
  ],
  subacute: [
    'is evaluated in the urgent care centre',
    'is evaluated in the office',
    'presents to the outpatient clinic',
    'is admitted to the general medical service',
  ],
  chronic: [
    'is evaluated in the office',
    'presents to the outpatient clinic',
    'is seen for a scheduled follow-up visit',
    'is referred to the specialty clinic',
    'is evaluated during a routine health maintenance visit',
  ],
};

const EMERGENT = /sudden|abrupt|acute|crisis|emergen|sepsis|shock|infarct|dissect|embol|hemorrhag|bleed|melena|emesis|ketoacid|mening|distress|tamponade|obstruct|perforat|stroke|seizure|syncope|overdose|profuse|exquisite|tearing|crushing|minutes of|hours of|hours after|refractory/i;
const SUBACUTE = /\b(two|three|four|five|six|seven|ten|twelve)?\s?days?\b|\bweeks?\b|\bweek of\b|days after|recently/i;

function acuityOf(topic) {
  const hay = `${topic.name} ${topic.pres}`;
  if (EMERGENT.test(hay)) return 'emergent';
  if (SUBACUTE.test(hay)) return 'subacute';
  return 'chronic';
}

function settingFor(topic) {
  const pool = SETTINGS[acuityOf(topic)]
    // Never place a patient in a setting the complaint already names.
    .filter((s) => !(/routine health maintenance/.test(s) && /routine|preventive/i.test(topic.pres)));
  return pick(pool.length ? pool : SETTINGS.chronic);
}

// "seen for a follow-up visit for six months of…" reads badly; pick a
// connector that does not repeat the preposition already in the setting.
const CONNECTORS = ['for', 'because of', 'with'];
const connectorFor = (setting) => pick(setting.includes(' for ')
  ? ['because of', 'with'] : CONNECTORS);
const COMORBID = [
  'hypertension', 'type 2 diabetes mellitus', 'hyperlipidemia', 'obesity',
  'chronic kidney disease', 'hypothyroidism', 'osteoarthritis', 'depression',
  'gastroesophageal reflux', 'seasonal allergic rhinitis', 'asthma',
  'atrial fibrillation', 'iron deficiency anemia', 'migraine',
];
const MEDS = [
  'lisinopril', 'atorvastatin', 'metformin', 'amlodipine', 'levothyroxine',
  'omeprazole', 'sertraline', 'aspirin', 'hydrochlorothiazide', 'metoprolol',
  'gabapentin', 'albuterol as needed',
];
// {S}/{s} subject, {P}/{p} possessive — resolved against the patient's sex.
const SOCIAL = [
  '{S} does not smoke and drinks alcohol occasionally.',
  '{S} has a 20 pack-year smoking history and drinks two beers on weekends.',
  '{S} works as a schoolteacher and exercises twice weekly.',
  '{S} is a retired machinist and lives alone.',
  '{S} recently returned from international travel.',
  '{S} does not use tobacco, alcohol, or recreational drugs.',
  '{S} lives with {p} partner and works night shifts.',
  '{S} has been under considerable occupational stress.',
  '{S} quit smoking eight years ago after a 15 pack-year history.',
  '{S} is a long-distance lorry driver with an irregular sleep schedule.',
  '{S} cares for two young children and reports little time for exercise.',
  '{S} drinks three to four units of alcohol most evenings.',
];
const FAMILY = [
  '{P} father had a myocardial infarction at 58 years of age.',
  '{P} mother has an autoimmune thyroid condition.',
  'There is no relevant family history.',
  'A sibling has a similar chronic illness.',
  'Family history is notable for early-onset malignancy.',
  '{P} mother and maternal aunt both have an inflammatory joint condition.',
];
const voice = (s, d) => s
  .replace(/\{S\}/g, d.subj).replace(/\{s\}/g, d.subj.toLowerCase())
  .replace(/\{P\}/g, d.poss).replace(/\{p\}/g, d.possL);
const EXAM_OPEN = [
  'On examination, the patient appears',
  'Physical examination shows a patient who is',
  'On presentation the patient is',
];
const APPEARANCE = [
  'comfortable at rest', 'mildly uncomfortable', 'in moderate distress',
  'alert and fully oriented', 'fatigued but cooperative', 'well appearing',
];

/* ── vitals, driven by the clinical picture ───────────────────────────── */

const KW = {
  febrile: /fever|infect|sepsis|pneumon|mening|celluli|abscess|osteomyel|pyelo|endocard|tubercul|influenza|zoster|mononucle|diarrhea|colitis|arthritis|arteritis/i,
  hypotensive: /sepsis|shock|bleed|hemorrhag|hypovol|adrenal insufficiency|tampon/i,
  hypertensive: /hypertens|pheochromo|dissect|renal artery|eclamp|cushing|hyperaldo/i,
  hypoxic: /pulmonary|respirat|asthma|copd|pneumo|embolism|ards|interstitial|effusion|apnea/i,
  tachycardic: /fibrillation|thyrotox|graves|ketoacid|embolism|sepsis|anemia|hemorrhag|panic|withdrawal/i,
  bradycardic: /hypothyroid|bradycard/i,
};
function vitals(topic) {
  const hay = `${topic.name} ${topic.pres} ${topic.find}`;
  const feb = KW.febrile.test(hay), hypo = KW.hypotensive.test(hay);
  const hyper = KW.hypertensive.test(hay), ox = KW.hypoxic.test(hay);
  const tachy = KW.tachycardic.test(hay), brady = KW.bradycardic.test(hay);

  const t = feb ? rf(38.1, 39.4) : rf(36.4, 37.2);
  let hr = ri(64, 88);
  if (tachy || feb) hr = ri(98, 126);
  if (brady) hr = ri(46, 58);
  let sys = ri(112, 134), dia = ri(66, 84);
  if (hyper) { sys = ri(158, 198); dia = ri(94, 116); }
  if (hypo) { sys = ri(78, 96); dia = ri(44, 58); }
  const rr = ox || feb ? ri(20, 28) : ri(12, 18);
  const spo2 = ox ? ri(86, 93) : ri(96, 99);

  return {
    t: t.toFixed(1), hr, bp: `${sys}/${dia}`, rr, spo2,
    flags: {
      t: feb, hr: tachy || feb || brady, bp: hyper || hypo, rr: ox || feb, spo2: ox,
    },
  };
}

/* ── laboratory panels ────────────────────────────────────────────────── */

const PANELS = {
  cbc: [
    ['Hemoglobin', () => rf(12.4, 15.6).toFixed(1), 'g/dL', '12.0–16.0'],
    ['Leukocyte count', () => rf(5.2, 10.4).toFixed(1), '×10⁹/L', '4.0–11.0'],
    ['Platelet count', () => ri(180, 380), '×10⁹/L', '150–400'],
  ],
  bmp: [
    ['Sodium', () => ri(136, 142), 'mEq/L', '135–145'],
    ['Potassium', () => rf(3.6, 4.8).toFixed(1), 'mEq/L', '3.5–5.0'],
    ['Creatinine', () => rf(0.7, 1.1).toFixed(2), 'mg/dL', '0.6–1.2'],
    ['Bicarbonate', () => ri(22, 27), 'mEq/L', '22–28'],
  ],
  lft: [
    ['Alanine aminotransferase', () => ri(14, 38), 'U/L', '7–45'],
    ['Alkaline phosphatase', () => ri(48, 112), 'U/L', '40–130'],
    ['Total bilirubin', () => rf(0.4, 1.0).toFixed(1), 'mg/dL', '0.2–1.2'],
    ['Albumin', () => rf(3.7, 4.6).toFixed(1), 'g/dL', '3.5–5.0'],
  ],
  inflam: [
    ['C-reactive protein', () => ri(2, 8), 'mg/L', '< 10'],
    ['Erythrocyte sedimentation rate', () => ri(6, 18), 'mm/h', '0–20'],
  ],
  endo: [
    ['Thyroid-stimulating hormone', () => rf(0.8, 3.6).toFixed(2), 'µIU/mL', '0.4–4.0'],
    ['Hemoglobin A1c', () => rf(5.1, 5.6).toFixed(1), '%', '< 5.7'],
  ],
};
const PANEL_FOR = {
  cardiology: ['cbc', 'bmp'], pulmonology: ['cbc', 'bmp'],
  gastroenterology: ['cbc', 'lft'], nephrology: ['bmp', 'cbc'],
  endocrinology: ['endo', 'bmp'], 'infectious-disease': ['cbc', 'inflam'],
  neurology: ['cbc', 'bmp'], 'hematology-oncology': ['cbc', 'bmp'],
  rheumatology: ['inflam', 'cbc'], psychiatry: ['bmp', 'endo'],
};

// Nudge one or two values out of range so the panel supports the vignette.
const ABNORMAL = [
  [/anemia|bleed|hemorrhag|iron|b12|myeloma|sickle/i, 'Hemoglobin', () => rf(7.4, 10.2).toFixed(1)],
  [/infect|sepsis|pneumon|celluli|mening|abscess|colitis/i, 'Leukocyte count', () => rf(14.2, 21.6).toFixed(1)],
  [/thrombocytopen|purpura/i, 'Platelet count', () => ri(9, 42)],
  [/kidney injury|tubular|chronic kidney|nephro|glomerul|renal/i, 'Creatinine', () => rf(2.1, 4.4).toFixed(2)],
  [/hyperkalem/i, 'Potassium', () => rf(6.1, 7.2).toFixed(1)],
  [/hyponatrem|antidiure/i, 'Sodium', () => ri(116, 126)],
  [/acidosis|ketoacid/i, 'Bicarbonate', () => ri(8, 15)],
  [/cirrhosis|hepatitis|choledocho|biliary|liver/i, 'Total bilirubin', () => rf(3.2, 7.8).toFixed(1)],
  [/cirrhosis|hepatitis/i, 'Alanine aminotransferase', () => ri(180, 460)],
  [/arteritis|polymyalgia|rheumatoid|lupus|vasculitis|angiitis/i, 'C-reactive protein', () => ri(48, 124)],
  [/arteritis|polymyalgia/i, 'Erythrocyte sedimentation rate', () => ri(68, 112)],
  [/hypothyroid/i, 'Thyroid-stimulating hormone', () => rf(14.2, 42.0).toFixed(2)],
  [/graves|thyrotox/i, 'Thyroid-stimulating hormone', () => rf(0.01, 0.04).toFixed(2)],
  [/diabetes|ketoacid/i, 'Hemoglobin A1c', () => rf(8.4, 12.6).toFixed(1)],
];

function labs(topic, slug) {
  const keys = PANEL_FOR[slug] || ['cbc', 'bmp'];
  const rows = [];
  for (const k of keys) for (const [name, gen, unit, ref] of PANELS[k]) {
    rows.push({ name, value: String(gen()), unit, ref, abn: false });
  }
  const hay = `${topic.name} ${topic.pres} ${topic.find} ${topic.mech}`;
  let hits = 0;
  for (const [re, name, gen] of ABNORMAL) {
    if (hits >= 2) break;
    if (!re.test(hay)) continue;
    const row = rows.find((r) => r.name === name);
    if (row && !row.abn) { row.value = String(gen()); row.abn = true; hits++; }
  }
  return rows;
}

/* ── vignette assembly ────────────────────────────────────────────────── */

function demographics(topic) {
  const [lo, hi] = topic.age || [24, 78];
  const age = ri(lo, hi);
  const sex = topic.sex ? topic.sex : chance(0.5) ? 'm' : 'f';
  return {
    age, sex,
    noun: sex === 'm' ? 'man' : 'woman',
    subj: sex === 'm' ? 'He' : 'She',
    obj: sex === 'm' ? 'him' : 'her',
    poss: sex === 'm' ? 'His' : 'Her',
    possL: sex === 'm' ? 'his' : 'her',
  };
}

function buildStem(topic, slug, opts) {
  const d = demographics(topic);
  const v = vitals(topic);
  const paras = [];

  const setting = settingFor(topic);
  const lead = `A ${d.age}-year-old ${d.noun} ${setting} ${connectorFor(setting)} ${topic.pres}.`;
  const hx = chance(0.72)
    ? `${d.poss} medical history includes ${sample(COMORBID, ri(1, 2)).join(' and ')}.`
    : `${d.subj} has no chronic medical conditions.`;
  const rx = chance(0.6)
    ? `Current medications are ${sample(MEDS, ri(1, 3)).join(', ')}.`
    : `${d.subj} takes no prescription medications.`;
  paras.push(`${lead} ${hx} ${rx}`);

  const social = [voice(pick(SOCIAL), d)];
  if (chance(0.35)) social.push(voice(pick(FAMILY), d));
  const examBits = [`${pick(EXAM_OPEN)} ${pick(APPEARANCE)}.`];
  if (opts.includeFind) examBits.push(`Examination is notable for ${topic.find}.`);
  paras.push(`${social.join(' ')} ${examBits.join(' ')}`);

  if (opts.revealDx) {
    paras.push(`The clinical picture is consistent with ${topic.name.toLowerCase()}.`);
  }

  const labRows = chance(0.62) ? labs(topic, slug) : null;
  return { d, paras, vitals: v, labs: labRows };
}

/* ── figures ──────────────────────────────────────────────────────────── */

function figFlow(topic) {
  return {
    type: 'flow',
    title: `Evaluation pathway — ${topic.name}`,
    caption: 'Illustrative pathway showing how the initial study directs subsequent management.',
    nodes: [
      { id: 'a', kind: 'start', label: `Presentation suggesting ${topic.name.toLowerCase()}` },
      { id: 'b', kind: 'step', label: cap(topic.test) },
      { id: 'c', kind: 'decision', label: 'Findings support the diagnosis?' },
      { id: 'd', kind: 'end', label: cap(topic.rx) },
      { id: 'e', kind: 'end', label: 'Broaden the differential and reassess' },
    ],
    edges: [
      { from: 'a', to: 'b' }, { from: 'b', to: 'c' },
      { from: 'c', to: 'd', label: 'Yes' }, { from: 'c', to: 'e', label: 'No' },
    ],
  };
}

function figBar(topic) {
  const feats = sample([
    'Presenting symptom', 'Characteristic examination finding', 'Supportive laboratory result',
    'Confirmatory imaging', 'Relevant risk factor', 'Associated comorbidity',
  ], 4);
  let v = 92;
  return {
    type: 'bar',
    title: `Reported frequency of features — ${topic.name}`,
    caption: 'Illustrative frequencies used to show relative discriminating value, not measured data.',
    yLabel: 'Patients (%)',
    series: feats.map((label) => { v = Math.max(14, v - ri(9, 26)); return { label, value: v }; }),
  };
}

function figLine(topic) {
  const n = 7;
  const mk = (start, slope, jitter) => Array.from({ length: n }, (_, i) =>
    [i, Math.max(2, Math.round(start + slope * i + rf(-jitter, jitter)))]);
  return {
    type: 'line',
    title: `Course after presentation — ${topic.name}`,
    caption: 'Illustrative trajectory contrasting treated and untreated courses over the first week.',
    xLabel: 'Day', yLabel: 'Severity index',
    series: [
      { name: 'With treatment', points: mk(78, -9.5, 4) },
      { name: 'Without treatment', points: mk(74, 1.8, 5) },
    ],
  };
}

function figPanels(topic) {
  return {
    type: 'panels',
    title: `Representative studies — ${topic.name}`,
    caption: 'Schematic panels standing in for the imaging described; not radiographic images.',
    panels: [
      { label: 'A', tone: 'dark', caption: 'Baseline study before intervention', marks: [{ x: 0.62, y: 0.4, note: '1' }] },
      { label: 'B', tone: 'mid', caption: `Finding corresponding to ${topic.name.toLowerCase()}`, marks: [{ x: 0.38, y: 0.55, note: '2' }, { x: 0.7, y: 0.3, note: '3' }] },
      { label: 'C', tone: 'light', caption: 'Follow-up study after management', marks: [] },
    ],
    legend: ['1 — Region of interest', '2 — Principal abnormality', '3 — Secondary change'],
  };
}

function figTimeline(topic) {
  return {
    type: 'timeline',
    title: `Typical tempo — ${topic.name}`,
    caption: 'Illustrative sequence from first symptom to definitive management.',
    events: [
      { t: 'Onset', label: cap(topic.pres.split(' ').slice(0, 6).join(' ')) },
      { t: 'Presentation', label: 'Clinical assessment and examination' },
      { t: 'Workup', label: cap(topic.test) },
      { t: 'Decision', label: 'Diagnosis established' },
      { t: 'Treatment', label: cap(topic.rx) },
    ],
  };
}

function figTrace(topic, slug) {
  const kind = slug === 'cardiology' ? 'ecg' : slug === 'pulmonology' ? 'spirometry' : 'monitor';
  return {
    type: 'trace',
    kind,
    title: kind === 'ecg' ? 'Rhythm strip (schematic)'
      : kind === 'spirometry' ? 'Flow–volume loop (schematic)' : 'Continuous monitoring (schematic)',
    caption: 'Stylised trace drawn to illustrate the described pattern; not a recorded tracing.',
    annotations: [
      { at: 0.28, label: 'Baseline segment' },
      { at: 0.63, label: 'Abnormality described in the vignette' },
    ],
  };
}

const FIGURES = [figFlow, figBar, figLine, figPanels, figTimeline, figTrace];

/* ── tables ───────────────────────────────────────────────────────────── */

function tblCompare(topic, other) {
  return {
    type: 'table',
    title: `Distinguishing ${topic.name} from ${other.name}`,
    caption: 'Side-by-side comparison of the features that separate the two presentations.',
    columns: ['Feature', topic.name, other.name],
    rows: [
      ['Typical presentation', cap(topic.pres), cap(other.pres)],
      ['Examination', cap(topic.find), cap(other.find)],
      ['Initial study', cap(topic.test), cap(other.test)],
      ['Initial management', cap(topic.rx), cap(other.rx)],
      ['Underlying process', cap(topic.mech), cap(other.mech)],
    ],
    note: 'Comparison table built from sample topic material.',
  };
}

function tblCriteria(topic) {
  return {
    type: 'table',
    title: `Supporting features — ${topic.name}`,
    caption: 'Findings that raise or lower the likelihood of the diagnosis.',
    columns: ['Finding', 'Direction', 'Comment'],
    rows: [
      [cap(topic.pres.split(',')[0]), 'Supports', 'The presenting complaint that anchors the differential.'],
      [cap(topic.find.split(',')[0]), 'Supports', 'Examination finding with the greatest discriminating value.'],
      ['Absence of the characteristic tempo', 'Argues against', 'Prompts reconsideration of alternative diagnoses.'],
      ['Response to initial therapy', 'Supports', 'Improvement after treatment reinforces the working diagnosis.'],
    ],
    note: 'Directional guide only — sample material.',
  };
}

function tblLabs(topic, slug) {
  const rows = labs(topic, slug);
  return {
    type: 'table',
    title: 'Laboratory panel with reference intervals',
    caption: 'Values outside the reference interval are marked.',
    columns: ['Test', 'Result', 'Units', 'Reference interval'],
    rows: rows.map((r) => [r.name, r.abn ? `${r.value} ✱` : r.value, r.unit, r.ref]),
    note: '✱ outside the reference interval.',
  };
}

function tblSteps(topic) {
  return {
    type: 'table',
    title: `Sequencing of management — ${topic.name}`,
    caption: 'Order of operations once the diagnosis is suspected.',
    columns: ['Step', 'Action', 'Rationale'],
    rows: [
      ['1', 'Stabilise and assess severity', 'Determines the setting and urgency of care.'],
      ['2', cap(topic.test), 'Establishes or excludes the working diagnosis.'],
      ['3', cap(topic.rx), 'Definitive initial management once confirmed.'],
      ['4', 'Arrange interval reassessment', 'Confirms response and detects complications early.'],
    ],
    note: null,
  };
}

/* ── archetypes ───────────────────────────────────────────────────────── */

// Four distractors sharing one sentence pattern reads as filler, so each
// archetype carries several rationales that rotate by position.
const ARCHETYPES = {
  dx: {
    label: 'Diagnosis',
    ask: 'Which of the following is the most likely diagnosis?',
    field: 'name',
    stem: { revealDx: false, includeFind: true },
    correctWhy: (t) =>
      `Correct. The combination of ${t.pres} with ${t.find} is the pattern that defines ${t.name.toLowerCase()}, which arises from ${t.mech}.`,
    wrongWhy: [
      (t, o) => `${cap(o.name)} would instead present with ${o.pres}. That history is absent here.`,
      (t, o) => `Examination in ${o.name.toLowerCase()} shows ${o.find}, which is not what is described.`,
      (t, o) => `${cap(o.name)} arises from ${o.mech} — a different process from the one producing these findings.`,
      (t, o) => `Nothing in the vignette points to ${o.name.toLowerCase()}, which would be worked up with ${o.test}.`,
    ],
  },
  mgmt: {
    label: 'Management',
    ask: 'Which of the following is the most appropriate next step in management?',
    field: 'rx',
    stem: { revealDx: true, includeFind: true },
    correctWhy: (t) =>
      `Correct. Once ${t.name.toLowerCase()} is established, ${t.rx} is the appropriate next step and addresses ${t.mech}.`,
    wrongWhy: [
      (t, o) => `${cap(o.rx)} is the treatment for ${o.name.toLowerCase()} and leaves ${t.mech} untouched.`,
      (t, o) => `This would be the right move had the patient presented with ${o.pres}.`,
      (t, o) => `${cap(o.rx)} neither relieves the presenting problem nor alters its course.`,
      (t, o) => `Reserve this for ${o.name.toLowerCase()}, where ${o.find} would be expected on examination.`,
    ],
  },
  test: {
    label: 'Diagnostic testing',
    ask: 'Which of the following is the most appropriate initial diagnostic test?',
    field: 'test',
    stem: { revealDx: false, includeFind: true },
    correctWhy: (t) =>
      `Correct. ${cap(t.test)} is the initial study that confirms ${t.name.toLowerCase()} and separates it from its closest mimics.`,
    wrongWhy: [
      (t, o) => `${cap(o.test)} is the first study when ${o.name.toLowerCase()} is suspected, and would not settle the question here.`,
      (t, o) => `This investigates ${o.mech}, which is not the process at work in this presentation.`,
      (t, o) => `A normal result would not exclude the diagnosis, so this does not advance the evaluation.`,
      (t, o) => `This is the study to order for ${o.pres} — a different clinical picture.`,
    ],
  },
  mech: {
    label: 'Mechanism',
    ask: 'Which of the following best explains the underlying mechanism?',
    field: 'mech',
    stem: { revealDx: true, includeFind: true },
    correctWhy: (t) =>
      `Correct. ${cap(t.mech)} is the process that produces ${t.pres} together with ${t.find}.`,
    wrongWhy: [
      (t, o) => `${cap(o.mech)} underlies ${o.name.toLowerCase()}, a distinct process.`,
      (t, o) => `This mechanism would produce ${o.pres} rather than the presentation described.`,
      (t, o) => `Were this the process at work, examination would show ${o.find}.`,
      (t, o) => `This explains ${o.name.toLowerCase()}, which is managed with ${o.rx}.`,
    ],
  },
  find: {
    label: 'Physical findings',
    ask: 'Which of the following additional findings is most likely on examination?',
    field: 'find',
    stem: { revealDx: false, includeFind: false },
    correctWhy: (t) =>
      `Correct. ${cap(t.find)} accompanies ${t.pres} in ${t.name.toLowerCase()} and follows directly from ${t.mech}.`,
    wrongWhy: [
      (t, o) => `${cap(o.find)} points toward ${o.name.toLowerCase()} rather than this presentation.`,
      (t, o) => `This finding belongs to ${o.name.toLowerCase()}, which arises from ${o.mech}.`,
      (t, o) => `You would expect this in a patient presenting with ${o.pres}.`,
      (t, o) => `This sign would redirect the evaluation toward ${o.test}.`,
    ],
  },
};
const ARCH_KEYS = Object.keys(ARCHETYPES);

/* ── peer statistics and difficulty ───────────────────────────────────── */

const BANDS = [
  { id: 'foundational', label: 'Foundational', min: 78 },
  { id: 'standard', label: 'Standard', min: 62 },
  { id: 'challenging', label: 'Challenging', min: 48 },
  { id: 'rigorous', label: 'Rigorous', min: 0 },
];
const bandFor = (pct) => BANDS.find((b) => pct >= b.min);

function peerStats(archetype) {
  // Mechanism and management items skew harder; diagnosis items skew easier.
  const shift = { dx: 8, find: 3, test: 0, mgmt: -4, mech: -7 }[archetype];
  const base = 34 + Math.round(56 * Math.pow(rand(), 0.78));
  const pct = Math.max(21, Math.min(94, base + shift + ri(-3, 3)));
  const n = ri(640, 9800);
  const avgSec = Math.round(46 + (100 - pct) * 1.15 + ri(-8, 14));
  return { pct, n, avgSec };
}

// Split the remaining share across distractors, with one common trap.
function distribution(pct) {
  const rest = 100 - pct;
  const w = [rf(1.6, 3.2), rf(0.7, 1.3), rf(0.5, 1.0), rf(0.3, 0.8)];
  const sum = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (x / sum) * rest);
  const out = raw.map((x) => Math.max(1, Math.round(x)));
  const drift = rest - out.reduce((a, b) => a + b, 0);
  out[0] = Math.max(1, out[0] + drift);
  return out;
}

/* ── item construction ────────────────────────────────────────────────── */

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

function buildItem(cat, topic, archetype, seq) {
  const A = ARCHETYPES[archetype];
  const pool = cat.topics.filter((t) => t.name !== topic.name);
  const correctText = cap(topic[A.field]);

  // Several topics in a category can share an initial study or management
  // step. Draw distractors only from topics whose option text is genuinely
  // distinct, so no two choices restate each other.
  const taken = new Set([correctText.toLowerCase()]);
  const others = [];
  for (const t of shuffle(pool)) {
    if (others.length === 4) break;
    const text = cap(t[A.field]).toLowerCase();
    if (taken.has(text)) continue;
    taken.add(text);
    others.push(t);
  }
  if (others.length < 4) {
    throw new Error(`${cat.slug}/${topic.name}/${archetype}: only ${others.length} distinct distractors`);
  }

  const stem = buildStem(topic, cat.slug, A.stem);
  // Rotate the rationale templates, offset per item so the same distractor
  // position does not always draw the same phrasing.
  const spin = ri(0, A.wrongWhy.length - 1);
  const options = [{ text: correctText, correct: true, why: A.correctWhy(topic) }]
    .concat(others.map((o, i) => ({
      text: cap(o[A.field]), correct: false,
      why: A.wrongWhy[(i + spin) % A.wrongWhy.length](topic, o),
    })));

  const ordered = shuffle(options);
  const { pct, n, avgSec } = peerStats(archetype);
  const dist = distribution(pct);
  let di = 0;
  const choices = ordered.map((o, i) => ({
    k: LETTERS[i], t: o.text, why: o.why,
    share: o.correct ? pct : dist[di++],
  }));
  const key = choices.find((_, i) => ordered[i].correct).k;

  // Explanation body.
  const contrast = others[0];
  const teach = [
    `${cap(topic.pres)} together with ${topic.find} is the presentation that should bring ${topic.name.toLowerCase()} to the front of the differential. The underlying process is ${topic.mech}.`,
    `${cap(topic.test)} is the appropriate initial study. It confirms the diagnosis while separating it from ${contrast.name.toLowerCase()}, which shares some surface features but presents with ${contrast.pres}.`,
    `Once confirmed, ${topic.rx} is the initial management. ${topic.teach}`,
  ];

  const fig = chance(0.46) ? pick(FIGURES)(topic, cat.slug) : null;
  let table = null;
  if (chance(0.38)) {
    const r = rand();
    table = r < 0.34 ? tblCompare(topic, contrast)
      : r < 0.6 ? tblCriteria(topic)
        : r < 0.82 ? tblLabs(topic, cat.slug) : tblSteps(topic);
  }

  const related = sample(pool, 3).map((t) => t.name);
  const id = `${CODES[cat.slug]}-${String(seq).padStart(4, '0')}`;

  return {
    id,
    cat: cat.slug,
    topic: topic.name,
    archetype,
    archetypeLabel: A.label,
    stem: {
      paras: stem.paras,
      vitals: stem.vitals,
      labs: stem.labs,
    },
    ask: A.ask,
    choices,
    key,
    teach: {
      summary: topic.teach,
      paras: teach,
      objective: `Recognise ${topic.name.toLowerCase()} from its characteristic presentation and identify ${A.field === 'name' ? 'the diagnosis' : `the appropriate ${A.label.toLowerCase()}`}.`,
    },
    figure: fig,
    table,
    related,
    tags: [cat.name, topic.name, A.label],
    peer: { pct, n, avgSec },
    diff: bandFor(pct).id,
  };
}

/* ── build ────────────────────────────────────────────────────────────── */

const index = { meta: {}, categories: [], items: [] };
const byCategory = {};
let total = 0;

for (const cat of CATEGORIES) {
  // 12 topics -> 100 items: four topics contribute nine, the rest eight.
  const counts = cat.topics.map((_, i) => (i < 4 ? 9 : 8));

  // Plan each topic's items, rotating archetypes so every topic is probed
  // from all five angles.
  const perTopic = cat.topics.map((topic, ti) => Array.from(
    { length: counts[ti] },
    (_, k) => ({ topic, archetype: ARCH_KEYS[(ti + k) % ARCH_KEYS.length] }),
  ));

  // Interleave across topics before numbering, so browsing the bank in id
  // order moves through the subject rather than sitting on one topic.
  const plan = [];
  for (let round = 0; ; round++) {
    let placed = false;
    for (const list of perTopic) {
      if (round < list.length) { plan.push(list[round]); placed = true; }
    }
    if (!placed) break;
  }

  let seq = 1;
  const items = plan.map((p) => buildItem(cat, p.topic, p.archetype, seq++));

  if (items.length !== TARGET_PER_CATEGORY) {
    throw new Error(`${cat.slug}: built ${items.length}, expected ${TARGET_PER_CATEGORY}`);
  }

  byCategory[cat.slug] = Object.fromEntries(items.map((q) => [q.id, q]));
  index.categories.push({
    slug: cat.slug, name: cat.name, abbr: ABBR[cat.slug], dot: cat.dot,
    blurb: BLURB[cat.slug], count: items.length,
    topics: cat.topics.map((t) => t.name),
  });
  for (const q of items) {
    index.items.push({
      id: q.id, cat: q.cat, topic: q.topic, archetype: q.archetype,
      archetypeLabel: q.archetypeLabel, diff: q.diff, pct: q.peer.pct,
      n: q.peer.n, avgSec: q.peer.avgSec, ask: q.ask,
      // The key travels in the index so a results table can score a test from
      // its own record, without depending on the latest global answer.
      key: q.key,
      preview: q.stem.paras[0].slice(0, 132).trim() + '…',
      hasFigure: !!q.figure, hasTable: !!q.table,
    });
  }
  total += items.length;
}

index.meta = {
  name: 'Meridian',
  built: '2026-07-26',
  total,
  categories: index.categories.length,
  bands: BANDS.map((b) => ({ id: b.id, label: b.label, min: b.min })),
  archetypes: ARCH_KEYS.map((k) => ({ id: k, label: ARCHETYPES[k].label })),
  notice: 'Sample content. Clinical detail is illustrative placeholder material for demonstrating the platform, not clinical guidance.',
};

mkdirSync(join(ROOT, 'data', 'questions'), { recursive: true });
writeFileSync(join(ROOT, 'data', 'index.json'), JSON.stringify(index));
for (const [slug, bank] of Object.entries(byCategory)) {
  writeFileSync(join(ROOT, 'data', 'questions', `${slug}.json`), JSON.stringify(bank));
}

/* ── reference laboratory values sheet ────────────────────────────────── */

const REFERENCE = {
  title: 'Reference intervals',
  note: 'Conventional adult reference intervals. Local laboratory values take precedence.',
  groups: [
    {
      name: 'Haematology', rows: [
        ['Hemoglobin', '13.5–17.5 g/dL (M) · 12.0–16.0 g/dL (F)'],
        ['Hematocrit', '41–53% (M) · 36–46% (F)'],
        ['Leukocyte count', '4,000–11,000/µL'],
        ['Platelet count', '150,000–400,000/µL'],
        ['Mean corpuscular volume', '80–100 fL'],
        ['Reticulocyte count', '0.5–1.5%'],
        ['Prothrombin time', '11–15 seconds'],
        ['Partial thromboplastin time', '25–35 seconds'],
      ],
    },
    {
      name: 'Chemistry', rows: [
        ['Sodium', '135–145 mEq/L'], ['Potassium', '3.5–5.0 mEq/L'],
        ['Chloride', '98–107 mEq/L'], ['Bicarbonate', '22–28 mEq/L'],
        ['Blood urea nitrogen', '7–20 mg/dL'], ['Creatinine', '0.6–1.2 mg/dL'],
        ['Glucose, fasting', '70–100 mg/dL'], ['Calcium', '8.5–10.5 mg/dL'],
        ['Magnesium', '1.6–2.6 mg/dL'], ['Phosphorus', '2.5–4.5 mg/dL'],
      ],
    },
    {
      name: 'Liver and pancreas', rows: [
        ['Alanine aminotransferase', '7–45 U/L'], ['Aspartate aminotransferase', '8–40 U/L'],
        ['Alkaline phosphatase', '40–130 U/L'], ['Total bilirubin', '0.2–1.2 mg/dL'],
        ['Albumin', '3.5–5.0 g/dL'], ['Lipase', '10–140 U/L'],
      ],
    },
    {
      name: 'Endocrine', rows: [
        ['Thyroid-stimulating hormone', '0.4–4.0 µIU/mL'], ['Free thyroxine', '0.8–1.8 ng/dL'],
        ['Hemoglobin A1c', '< 5.7%'], ['Cortisol, morning', '5–25 µg/dL'],
        ['Parathyroid hormone', '10–65 pg/mL'],
      ],
    },
    {
      name: 'Inflammation and cardiac', rows: [
        ['C-reactive protein', '< 10 mg/L'], ['Erythrocyte sedimentation rate', '0–20 mm/h (M) · 0–30 mm/h (F)'],
        ['High-sensitivity troponin', 'Assay-specific'], ['B-type natriuretic peptide', '< 100 pg/mL'],
        ['Ferritin', '15–200 ng/mL'],
      ],
    },
    {
      name: 'Arterial blood gas', rows: [
        ['pH', '7.35–7.45'], ['Pco₂', '35–45 mm Hg'], ['Po₂', '80–100 mm Hg'],
        ['Bicarbonate', '22–26 mEq/L'], ['Oxygen saturation', '95–100%'],
      ],
    },
  ],
};
writeFileSync(join(ROOT, 'data', 'reference.json'), JSON.stringify(REFERENCE));

/* ── the library ──────────────────────────────────────────────────────── */

const lib = writeLibrary(ROOT, CATEGORIES, CODES, ABBR, BLURB);

/* ── report ───────────────────────────────────────────────────────────── */

const counts = index.items.reduce((m, q) => ((m[q.diff] = (m[q.diff] || 0) + 1), m), {});
console.log(`Built ${total} items across ${index.categories.length} categories.`);
console.log('Difficulty spread:', BANDS.map((b) => `${b.label} ${counts[b.id] || 0}`).join(' · '));
console.log('Figures:', index.items.filter((q) => q.hasFigure).length,
  '· Tables:', index.items.filter((q) => q.hasTable).length);
console.log(`Library: ${lib.total} topics across ${lib.chapters} chapters · ${lib.words.toLocaleString()} words.`);
