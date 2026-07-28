/* Shared item rendering.

   The runner and the bank browser show the same question in different states,
   so the vignette and the explanation are built here once. Every passage is a
   highlightable block with a stable id. */

import { h, frag } from '../core/dom.js';
import { block } from './prose.js';
import { figureBlock } from './figure.js';
import { tableBlock, vitalsStrip, labTable } from './table.js';
import * as store from '../core/store.js';
import { bandLabel } from '../core/bank.js';
import { library, sectionForArchetype } from '../core/library.js';

/** Vignette: clinical paragraphs, vitals, laboratory panel, and the lead-in. */
export function vignette(q) {
  const hls = store.highlightsFor(q.id);
  return frag(
    h('div.vig', q.stem.paras.map((p, i) => block('p', p, `stem-${i}`, hls))),
    vitalsStrip(q.stem.vitals),
    labTable(q.stem.labs),
    block('p.ask', q.ask, 'ask', hls),
  );
}

/**
 * Explanation block.
 * @param {object} q
 * @param {{picked?:string|null, mySec?:number, onClipFigure?:Function, onClipTable?:Function, showPeer?:boolean, onTopic?:Function}} opts
 */
export function explanation(q, {
  picked = null, mySec = 0, onClipFigure, onClipTable, showPeer = true, onTopic,
} = {}) {
  const hls = store.highlightsFor(q.id);
  const right = picked === q.key;

  const clipBtn = (label, fn) => (fn
    ? h('button.btn.btn--sm', { onclick: fn, title: `Save this ${label} to your notebook` }, 'Save to notebook')
    : null);

  return h('div.expl',
    h('div', { class: `expl__verdict expl__verdict--${!picked ? 'omit' : right ? 'right' : 'wrong'}` },
      h('div.expl__vi', !picked ? '–' : right ? '✓' : '✕'),
      h('div.grow',
        h('b', !picked ? 'Not answered' : right ? 'Correct' : 'Incorrect'),
        h('p', !picked
          ? `The answer is ${q.key}.`
          : right ? `You chose ${q.key}.`
            : `You chose ${picked}. The answer is ${q.key}.`))),

    showPeer
      ? h('div.expl__stats',
        h('div.expl__stat', h('span', 'Answered correctly'), h('b', `${q.peer.pct}%`)),
        h('div.expl__stat', h('span', 'Difficulty'), h('b', bandLabel(q.diff))),
        h('div.expl__stat', h('span', 'Your time'), h('b', mySec ? `${mySec}s` : '—')),
        h('div.expl__stat', h('span', 'Average time'), h('b', `${q.peer.avgSec}s`)))
      : null,

    block('div.expl__lead', q.teach.summary, 'summary', hls),

    h('h3', 'Explanation'),
    h('div.expl__body', q.teach.paras.map((p, i) => block('p', p, `teach-${i}`, hls))),

    q.figure ? figureBlock(q.figure, { actions: clipBtn('figure', onClipFigure) }) : null,
    q.table ? tableBlock(q.table, { actions: clipBtn('table', onClipTable) }) : null,

    h('h3', 'Why each answer'),
    h('div.why', q.choices.map((c) => h('div', {
      class: `why__row${c.k === q.key ? ' why__row--right' : c.k === picked ? ' why__row--picked' : ''}`,
    },
      h('span.why__k', c.k),
      block('div.why__t', c.why, `why-${c.k}`, hls)))),

    block('div.objective', q.teach.objective, 'objective', hls),

    libraryFooter(q, onTopic),
  );
}

/* The way from an item into the reading it comes from. It sits at the end of
   the explanation, where a reader who wants more has just finished wanting it,
   and opens the section this item examines rather than the top of the topic. */
function libraryFooter(q, onTopic) {
  const id = (name) => library.byQuestionTopic.get(`${q.cat}|${name}`);
  const mine = id(q.topic);
  const section = sectionForArchetype(q.archetype);
  const related = (q.related || []).map((name) => ({ name, tid: id(name) }));

  if (!mine && !related.some((r) => r.tid)) {
    // No library built: keep the plain list rather than an empty section.
    return frag(
      h('h3', 'Related topics in this bank'),
      h('div.related', (q.related || []).map((t) => h('span.badge', t))));
  }

  return frag(
    h('h3', 'In the library'),
    mine
      ? h('div.expl__lib',
        h('div.grow',
          h('b', q.topic),
          h('p', `Read the full topic — this item examines ${sectionName(section)}.`)),
        h('button.btn.btn--sm.btn--primary', {
          onclick: () => onTopic?.(mine, section),
        }, 'Read topic'))
      : null,
    h('div.related',
      related.map(({ name, tid }) => (tid
        ? h('button.badge.badge--link', { onclick: () => onTopic?.(tid, null) }, name)
        : h('span.badge', name)))),
  );
}

const sectionName = (id) => (library.index?.meta.sections || [])
  .find((s) => s.id === id)?.heading.toLowerCase() || 'this topic';

/** Static answer list used where choices are not interactive. */
export function staticChoices(q, { picked = null, showPeer = true } = {}) {
  return h('div.choices',
    q.choices.map((c) => {
      const isKey = c.k === q.key;
      const isPick = c.k === picked;
      let cls = 'div.choice';
      if (isKey) cls += '.choice--right';
      else if (isPick) cls += '.choice--wrong';
      return h(cls, { style: { cursor: 'default' } },
        h('span.choice__k', c.k),
        h('span.choice__t', c.t),
        showPeer ? h('span.choice__pct', `${c.share}%`) : null,
        h('span.choice__bar', {
          style: { width: `${c.share}%`, background: isKey ? '#3f8f5f' : 'var(--ink-4)' },
        }));
    }));
}
