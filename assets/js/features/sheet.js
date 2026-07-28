/* The reading sheet.

   A surface that opens over whatever is being read without closing it. It is
   placed in the shell's grid at the main column, so it covers the page and
   never the notebook — the note you are writing into stays beside it, which is
   the whole point of reading and writing at the same time.

   It carries two kinds of content and the same chrome for both: a library
   topic opened from a question, and a question opened from the library. A
   shallow history lets one lead to the other and back, so following a link
   never costs the reader their place. */

import { h, fill, $ } from '../core/dom.js';
import * as store from '../core/store.js';
import { go, openAway } from '../core/router.js';
import { getTopic, topicMeta, chapter, highlightKey } from '../core/library.js';
import { getQuestion, meta, cat } from '../core/bank.js';
import { topicDocument, outline, topicQuestionCount } from '../render/topic.js';
import { vignette, explanation, staticChoices } from '../render/item.js';
import { attachHighlighter, hidePopover } from './highlight.js';
import { clipPassage } from './capture.js';
import { catTag, diffPips } from '../views/parts.js';
import { toast } from './overlay.js';

const MIN_W = 420;
const SHUT_W = 300;          // drag narrower than this and letting go closes it

let layer = null;            // the grid cell the sheet lives in
let sheetEl = null;
let detachHl = null;
let stack = [];              // [{ kind, id, section }]

export const isSheetOpen = () => !!layer;

/* ── opening ──────────────────────────────────────────────────────────── */

/** Open a library topic. `section` scrolls to one heading. */
export function openTopic(id, { section = null, push = false } = {}) {
  enter({ kind: 'topic', id, section }, push);
}

/** Open a question, as the library's questions do. */
export function openItem(id, { push = false } = {}) {
  enter({ kind: 'item', id }, push);
}

function enter(entry, push) {
  if (push && stack.length) stack.push(entry);
  else stack = [entry];
  mount();
  draw();
}

export function closeSheet() {
  if (!layer) return;
  detachHl?.(); detachHl = null;
  hidePopover();
  layer.remove();
  layer = null; sheetEl = null; stack = [];
  document.removeEventListener('keydown', onKey, true);
}

function back() {
  if (stack.length < 2) { closeSheet(); return; }
  stack.pop();
  draw();
}

/* ── mounting ─────────────────────────────────────────────────────────── */

function mount() {
  if (layer) return;
  layer = h('div.sheet-layer');
  sheetEl = h('aside.sheet', {
    role: 'dialog',
    'aria-label': 'Reading',
    style: { width: `${width()}px` },
  });
  layer.append(
    h('div.sheet__scrim', { onclick: closeSheet, title: 'Close' }),
    sheetEl,
  );
  $('#app').appendChild(layer);
  document.addEventListener('keydown', onKey, true);
}

const width = () => Math.max(MIN_W, store.prefs().sheetWidth || 760);

function onKey(ev) {
  if (ev.key !== 'Escape' || !layer) return;
  // A popover inside the sheet gets the first refusal on Escape.
  if (!$('#selPop')?.hidden) { hidePopover(); ev.stopPropagation(); return; }
  if ($('#modal') && !$('#modal').hidden) return;
  ev.preventDefault();
  ev.stopPropagation();
  closeSheet();
}

/* ── drawing ──────────────────────────────────────────────────────────── */

async function draw() {
  const entry = stack[stack.length - 1];
  if (!entry || !sheetEl) return;

  detachHl?.(); detachHl = null;
  hidePopover();

  fill(sheetEl,
    h('div.sheet__grip', { title: 'Drag to resize', onpointerdown: startResize }),
    h('div.sheet__load', 'Loading…'));

  try {
    if (entry.kind === 'topic') await drawTopic(entry);
    else await drawItem(entry);
  } catch (err) {
    console.error(err);
    fill(sheetEl,
      h('div.sheet__grip', { onpointerdown: startResize }),
      header({ title: 'Not available', sub: null, actions: [] }),
      h('div.sheet__body', h('div.wrap', h('p.muted', err.message || 'This could not be opened.'))));
  }
}

/** Header shared by both kinds, so the chrome never shifts under the reader. */
function header({ title, sub, actions, lead = null }) {
  return h('header.sheet__head',
    stack.length > 1
      ? h('button.sheet__ico', { title: 'Back', 'aria-label': 'Back', onclick: back }, '‹')
      : null,
    h('div.sheet__title',
      h('div.row', { style: { gap: '8px', minWidth: 0 } }, lead, h('h2.truncate', title)),
      sub ? h('p.truncate', sub) : null),
    h('div.sheet__act', actions,
      h('button.sheet__ico', {
        title: 'Close  Esc', 'aria-label': 'Close', onclick: closeSheet,
      }, '✕')));
}

/* ── a topic ──────────────────────────────────────────────────────────── */

async function drawTopic(entry) {
  const doc = await getTopic(entry.id);
  const ch = chapter(doc.cat);
  const qCount = topicQuestionCount(doc);

  const tocOpen = store.prefs().libToc !== false;

  const body = h('div.sheet__doc.scroll');
  const nav = h('nav.sheet__toc', { 'aria-label': 'Contents' });

  const paint = () => {
    const art = topicDocument(doc, {
      showQuestions: store.prefs().libQuestions === true,
      onQuestion: (qid) => openItem(qid, { push: true }),
    });
    fill(body, h('div.sheet__inner', art,
      doc.related?.length
        ? h('div.topic__related',
          h('p.label', 'Related topics'),
          h('div.row.row--wrap', { style: { gap: '6px' } },
            doc.related.map((rid) => {
              const m = topicMeta(rid);
              return m ? h('button.chip', {
                onclick: () => openTopic(rid, { push: true }),
              }, m.title) : null;
            })))
        : null));

    detachHl?.();
    detachHl = attachHighlighter(art, {
      qid: highlightKey(doc.id),
      clip: ({ text, label }) => clipPassage({
        topicId: doc.id, title: doc.title, text, source: label,
      }),
    });
    drawToc();
  };

  function drawToc() {
    fill(nav,
      h('p.label', 'Contents'),
      h('ul.sheet__toc-list', outline(doc).map((s) => h('li',
        h('button.sheet__toc-l', {
          onclick: () => scrollToSection(body, s.id, true),
        }, s.heading)))),
      h('label.sheet__toggle', {
        title: 'Show the bank’s questions beside the passage each one examines',
      },
        h('input', {
          type: 'checkbox',
          checked: store.prefs().libQuestions === true,
          onchange: (ev) => { store.setPref('libQuestions', ev.target.checked); paint(); },
        }),
        h('span', 'Questions'),
        qCount ? h('span.sheet__toggle-n', qCount) : null),
    );
  }

  fill(sheetEl,
    h('div.sheet__grip', { title: 'Drag to resize', onpointerdown: startResize }),
    header({
      title: doc.title,
      sub: `${ch?.name || doc.cat} · ${doc.sections.length} sections`,
      lead: h('span.dot', { style: { background: ch?.dot || 'var(--ink-4)' } }),
      actions: [
        h('button.sheet__ico', {
          title: 'Contents', 'aria-label': 'Contents',
          'aria-pressed': String(tocOpen),
          onclick: (ev) => {
            const on = sheetEl.classList.toggle('sheet--noToc');
            store.setPref('libToc', !on);
            ev.currentTarget.setAttribute('aria-pressed', String(!on));
          },
        }, '☰'),
        h('button.btn.btn--sm', {
          title: 'Open this topic in the library',
          onclick: () => {
            const id = doc.id;
            // Over a question, the library gets a tab of its own and the
            // question keeps the one it is in.
            if (openAway(`/library/${id}`)) { closeSheet(); toast('Opened in a new tab'); }
            else { closeSheet(); go(`/library/${id}`); }
          },
        }, 'Open in library'),
      ],
    }),
    h('div.sheet__body', nav, body));

  sheetEl.classList.toggle('sheet--noToc', !tocOpen);
  paint();

  // Measured and set directly rather than through scrollIntoView on a frame
  // callback: the section is in the document already, and a sheet opened in a
  // background tab would otherwise arrive at the top of the topic.
  if (entry.section) scrollToSection(body, entry.section);
}

function scrollToSection(body, id, smooth = false) {
  const target = body.querySelector(`#sec-${CSS.escape(id)}`);
  if (!target) return;
  const top = body.scrollTop
    + target.getBoundingClientRect().top - body.getBoundingClientRect().top - 10;
  body.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
}

/* ── a question ───────────────────────────────────────────────────────── */

async function drawItem(entry) {
  const m = meta(entry.id);
  const q = await getQuestion(entry.id);
  const answer = store.answerFor(entry.id);

  const inner = h('div.sheet__inner.sheet__item',
    vignette(q),
    staticChoices(q, { picked: answer?.c || null, showPeer: store.prefs().showPeer }),
    explanation(q, {
      picked: answer?.c || null,
      mySec: answer ? Math.round((answer.ms || 0) / 1000) : 0,
      showPeer: store.prefs().showPeer,
      onTopic: (tid, section) => openTopic(tid, { section, push: true }),
    }));

  const body = h('div.sheet__doc.scroll', inner);

  fill(sheetEl,
    h('div.sheet__grip', { title: 'Drag to resize', onpointerdown: startResize }),
    header({
      title: q.topic,
      sub: `${cat(q.cat)?.name || q.cat} · ${q.archetypeLabel}`,
      lead: h('span.item-head__id', q.id),
      actions: [
        diffPips(q.diff, { withName: false }),
        h('button.btn.btn--sm', {
          title: 'Open this item on its own page',
          onclick: () => {
            const id = entry.id;
            if (openAway(`/browse/${id}`)) { closeSheet(); toast('Opened in a new tab'); }
            else { closeSheet(); go(`/browse/${id}`); }
          },
        }, 'Open item'),
      ],
    }),
    h('div.sheet__body.sheet__body--plain', body));

  detachHl = attachHighlighter(inner, { qid: entry.id });
}

/* ── resize ───────────────────────────────────────────────────────────── */

/* The same gesture the notebook uses: drag the edge, and carrying on past the
   point where the text is still worth reading closes it rather than sticking
   at a minimum. */
function startResize(ev) {
  ev.preventDefault();
  const right = layer.getBoundingClientRect().right;
  const max = layer.getBoundingClientRect().width;
  document.body.classList.add('resizing-panel');

  const raw = (e) => Math.min(max, right - e.clientX);
  const shutting = (e) => raw(e) < SHUT_W;
  let last = ev;

  const move = (e) => {
    last = e;
    sheetEl.style.width = `${Math.max(120, raw(e))}px`;
    sheetEl.classList.toggle('sheet--shutting', shutting(e));
  };

  const finish = (e, cancelled) => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('keydown', esc, true);
    document.body.classList.remove('resizing-panel');
    sheetEl?.classList.remove('sheet--shutting');

    if (cancelled) { sheetEl.style.width = `${width()}px`; return; }
    if (shutting(e)) {
      // Closing empties the history, so the way back is kept before it goes.
      const trail = stack.slice();
      closeSheet();
      toast('Closed', {
        action: 'Reopen',
        onAction: () => { stack = trail; mount(); draw(); },
      });
      return;
    }
    const w = Math.max(MIN_W, Math.min(max, raw(e)));
    sheetEl.style.width = `${w}px`;
    store.setPref('sheetWidth', w);
  };

  const up = (e) => finish(e, false);
  const esc = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    finish(last, true);
  };

  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('keydown', esc, true);
}
