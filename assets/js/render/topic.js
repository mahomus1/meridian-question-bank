/* A library topic, rendered as a document.

   The same element is used by the reading sheet and by the full-page viewer,
   so a topic reads identically wherever it is opened. Every paragraph is a
   highlightable block with a stable id, exactly as a question's passages are,
   which is what lets one highlighting implementation serve both. */

import { h } from '../core/dom.js';
import { block } from './prose.js';
import { tableBlock } from './table.js';
import * as store from '../core/store.js';
import { highlightKey } from '../core/library.js';
import { bank } from '../core/bank.js';
import { diffPips, statusPip } from '../views/parts.js';
import { statusOf } from '../core/bank.js';

/** Questions in the bank that examine `section` of this topic. */
export function questionsFor(doc, archetype) {
  if (!bank.index || !archetype) return [];
  return bank.index.items.filter((it) => it.cat === doc.cat
    && it.topic === doc.topic
    && it.archetype === archetype);
}

export function topicQuestionCount(doc) {
  if (!bank.index) return 0;
  return bank.index.items.filter((it) => it.cat === doc.cat && it.topic === doc.topic).length;
}

/**
 * @param {object} doc                 full topic body
 * @param {{onQuestion?:Function, showQuestions?:boolean}} opts
 */
export function topicDocument(doc, { onQuestion, showQuestions = false, showBlurb = true } = {}) {
  const hls = store.highlightsFor(highlightKey(doc.id));

  const paras = (sec) => sec.paras.map((text, i) => {
    const el = block('p', text, `${sec.id}.${i}`, hls);
    // Read back by the highlighter when it names where a passage came from.
    el.dataset.hlLabel = sec.heading;
    return el;
  });

  const lead = block('p.topic__lead', doc.summary, 'summary', hls);
  lead.dataset.hlLabel = 'Summary';

  return h('article.topic',
    // What the entry covers, in a line, under whichever heading names it —
    // unless the page has put it beside its own title already.
    showBlurb && doc.blurb ? h('p.topic__blurb', doc.blurb) : null,
    lead,

    doc.keyPoints?.length
      ? h('div.topic__keys',
        h('p.label', 'Key points'),
        h('ul', doc.keyPoints.map((k) => h('li', k))))
      : null,

    doc.sections.map((sec) => {
      const items = showQuestions ? questionsFor(doc, sec.archetype) : [];
      return h('section.topic__sec', { dataset: { sec: sec.id } },
        h('h2.topic__h', { id: `sec-${sec.id}` }, sec.heading),
        paras(sec),
        sec.table ? tableBlock(sec.table) : null,
        items.length ? questionList(items, sec, onQuestion) : null);
    }),
  );
}

/* Questions belonging to one section, shown only when the reader asks for
   them. They sit under the passage they examine rather than in a single list
   at the end, which is the whole reason the sections carry an archetype. */
function questionList(items, sec, onQuestion) {
  return h('div.topic__qs',
    h('p.label', `Questions on ${sec.heading.toLowerCase()}`),
    h('div.topic__qlist', items.map((it) => h('button.topic__q', {
      type: 'button',
      title: `Open ${it.id}`,
      onclick: () => onQuestion?.(it.id),
    },
      statusPip(statusOf(it.id)),
      h('span.topic__q-id', it.id),
      h('span.topic__q-ask.truncate', it.ask),
      diffPips(it.diff, { withName: false })))));
}

/** Section headings for a contents list. */
export const outline = (doc) => doc.sections.map((s) => ({ id: s.id, heading: s.heading }));
