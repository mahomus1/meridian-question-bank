/* Reusable view pieces. */

import { h } from '../core/dom.js';
import { cat, bandLabel } from '../core/bank.js';
import { pct as fpct } from '../core/fmt.js';

/** Circular progress with a value in the middle. */
export function ring(value, { size = 74, stroke = 7, label = '', tone = 'var(--blue)' } = {}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - Math.max(0, Math.min(100, value)) / 100);
  return h('div.ring', { style: { width: `${size}px`, height: `${size}px` } },
    h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' },
      h('circle', {
        class: 'ring__track', cx: size / 2, cy: size / 2, r,
        fill: 'none', 'stroke-width': stroke,
      }),
      h('circle', {
        class: 'ring__fill', cx: size / 2, cy: size / 2, r,
        fill: 'none', 'stroke-width': stroke, stroke: tone,
        'stroke-dasharray': circ, 'stroke-dashoffset': off,
      })),
    h('div.ring__mid',
      h('b', `${Math.round(value)}%`),
      label && h('span', label)),
  );
}

/** Difficulty indicator: four pips, filled to the band's level. */
export function diffPips(band, { withName = true } = {}) {
  const order = ['foundational', 'standard', 'challenging', 'rigorous'];
  const level = order.indexOf(band) + 1;
  return h('span.diff', { dataset: { lvl: band }, title: `${bandLabel(band)} difficulty` },
    h('span.diff__pips',
      order.map((_, i) => h(`span.diff__pip${i < level ? '.on' : ''}`))),
    withName && h('span.diff__name', bandLabel(band)),
  );
}

/** Category name with its colour dot. */
export function catTag(slug, { abbr = false } = {}) {
  const c = cat(slug);
  if (!c) return h('span', slug);
  return h('span.item-head__cat',
    h('span.dot', { style: { background: c.dot } }),
    abbr ? c.abbr : c.name);
}

/**
 * Labelled bar with an optional peer marker.
 * @param {{label:string, value:number|null, peer?:number, sub?:string, tone?:string}} o
 */
export function barRow({ label, value, peer, sub, tone }) {
  const v = value === null || value === undefined ? 0 : value;
  const colour = tone || (v >= 75 ? '#3f8f5f' : v >= 55 ? 'var(--blue)' : v >= 40 ? '#c08a2a' : '#b45445');
  return h('div.bar-row',
    h('div.bar-row__top',
      h('b', label),
      sub && h('span.bar-row__peer', sub),
      h('span.bar-row__v', value === null || value === undefined ? '—' : fpct(v))),
    h('div.bar-track',
      h('div.bar-fill', { style: { width: `${v}%`, background: colour } }),
      peer !== undefined && peer !== null
        && h('div.bar-peer', { style: { left: `calc(${peer}% - 1px)` }, title: `Peer average ${Math.round(peer)}%` })),
  );
}

export function empty({ mark = '·', title, text, action }) {
  return h('div.empty',
    h('div.empty__mark', mark),
    h('h3', title),
    text && h('p', text),
    action);
}

export function statBlock(value, key, delta) {
  return h('div.stat',
    h('div.stat__v', value),
    h('div.stat__k', key),
    delta && h('div.stat__d', { class: delta.startsWith('−') || delta.startsWith('-') ? 'stat__d--down' : 'stat__d--up' }, delta));
}

export function sectionHead(title, sub, ...actions) {
  return h('div.shead',
    h('h2', title),
    sub && h('p', sub),
    actions.length ? h('div.push', actions) : null);
}

/** Status pip used in question lists. */
export function statusPip(status) {
  const cls = status === 'correct' ? 'right' : status === 'incorrect' ? 'wrong' : 'none';
  const title = status === 'correct' ? 'Answered correctly'
    : status === 'incorrect' ? 'Answered incorrectly' : 'Not yet answered';
  return h(`span.status-pip.status-pip--${cls}`, { title, role: 'img', 'aria-label': title });
}

/** The standing note about the nature of the sample content. */
export function sampleNotice() {
  return h('div.notice',
    h('div', h('b', 'Sample content. '),
      'Clinical detail throughout this bank is illustrative placeholder material built to demonstrate the platform. It is not clinical guidance and should not be studied as fact.'));
}
