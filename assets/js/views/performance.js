/* Performance: accuracy over time, by category, by difficulty, and by pace. */

import { h } from '../core/dom.js';
import * as store from '../core/store.js';
import { bank } from '../core/bank.js';
import { go } from '../core/router.js';
import { n, pct, duration, dateShort } from '../core/fmt.js';
import { ring, barRow, empty, sectionHead, statBlock } from './parts.js';

export default async function performance() {
  const o = store.overall();
  const cats = store.byCategory(bank.index);
  const diffs = store.byDifficulty(bank.index);
  const days = store.trend(30);
  const streak = store.streak();

  const el = h('div.wrap');

  if (!o.done) {
    el.appendChild(empty({
      mark: '◔', title: 'No performance data yet',
      text: 'Answer some questions and this page will show accuracy over time, by category, by difficulty, and against the peer average.',
      action: h('button.btn.btn--primary', { onclick: () => go('/create') }, 'Create a test'),
    }));
    return { title: 'Performance', el };
  }

  const peerOverall = Math.round(
    Object.keys(store.state.answers).reduce((s, id) => s + (bank.byId.get(id)?.pct || 0), 0) / o.done);

  /* summary */
  el.appendChild(h('div.score-hero', { style: { marginBottom: '20px' } },
    ring(o.pct, { size: 108, stroke: 9, label: 'overall' }),
    h('div.col', { style: { gap: '14px' } },
      h('div',
        h('h2.h2', o.pct >= peerOverall
          ? `${pct(o.pct)} overall — ${o.pct - peerOverall} points above the peer average`
          : `${pct(o.pct)} overall — ${peerOverall - o.pct} points below the peer average`),
        h('p.sm.muted', `${n(o.done)} of ${n(bank.index.meta.total)} items answered · ${duration(o.totalMs)} of study time`)),
      h('div.stat-grid',
        statBlock(n(o.right), 'Correct'),
        statBlock(n(o.wrong), 'Incorrect'),
        statBlock(`${o.avgSec}s`, 'Average pace'),
        statBlock(streak ? `${streak}` : '0', streak === 1 ? 'Day streak' : 'Day streak')))));

  /* trend */
  const active = days.filter((d) => d.done);
  el.appendChild(h('div.panel', { style: { marginBottom: '20px' } },
    h('div.panel__head',
      h('h2', 'Accuracy over the last 30 days'),
      h('div.panel__act', h('span.xs.muted',
        `${n(active.length)} active day${active.length === 1 ? '' : 's'}`))),
    h('div.panel__body',
      active.length >= 2
        ? trendChart(days)
        : empty({ title: 'Not enough history yet', text: 'Study on two or more days to see a trend.' }))));

  /* breakdowns */
  el.appendChild(h('div.perf-grid',
    h('div.panel',
      h('div.panel__head', h('h2', 'By category'),
        h('div.panel__act', h('span.xs.muted', 'Marker shows the peer average'))),
      h('div.panel__body',
        bank.index.categories
          .map((c) => ({ c, s: cats[c.slug] }))
          .filter((x) => x.s.done)
          .sort((a, b) => a.s.pct - b.s.pct)
          .map(({ c, s }) => barRow({
            label: c.name, value: s.pct, peer: s.peerPct,
            sub: `${s.done}/${s.total} answered`,
          })))),

    h('div.panel',
      h('div.panel__head', h('h2', 'By difficulty')),
      h('div.panel__body',
        bank.index.meta.bands
          .filter((b) => diffs[b.id]?.done)
          .map((b) => barRow({
            label: b.label,
            value: diffs[b.id].pct,
            sub: `${diffs[b.id].done} of ${diffs[b.id].total}`,
          }))))));

  /* coverage */
  el.appendChild(h('div', { style: { marginTop: '20px' } },
    sectionHead('Coverage', 'How much of each category you have worked through'),
    h('div.panel',
      h('div.panel__body',
        h('div.stack-8',
          bank.index.categories.map((c) => {
            const s = cats[c.slug];
            const share = Math.round((s.done / s.total) * 100);
            return h('div.row', { style: { gap: '12px' } },
              h('span.dot', { style: { background: c.dot } }),
              h('span.sm', { style: { width: '190px', flex: 'none' } }, c.name),
              h('div.grow',
                h('div.meter',
                  h('div.meter__fill', { style: { width: `${share}%`, background: c.dot } }))),
              h('span.xs.muted.num', { style: { width: '86px', textAlign: 'right' } },
                `${n(s.done)}/${n(s.total)}`),
              h('span.xs.num', { style: { width: '42px', textAlign: 'right', fontWeight: 600 } },
                s.pct === null ? '—' : `${s.pct}%`));
          }))))));

  return {
    title: 'Performance',
    subtitle: `${n(o.done)} answered · ${pct(o.pct)} correct · ${duration(o.totalMs)}`,
    actions: [h('button.btn.btn--primary', { onclick: () => go('/create') }, 'Create test')],
    el,
  };
}

/* ── trend chart ──────────────────────────────────────────────────────── */

function trendChart(days) {
  const W = 900, H = 190, L = 34, R = 12, T = 12, B = 30;
  const pw = W - L - R, ph = H - T - B;
  const pts = days.map((d, i) => ({ ...d, i }));
  const withData = pts.filter((p) => p.pct !== null);
  if (withData.length < 2) return h('div');

  const px = (i) => L + (i / (days.length - 1)) * pw;
  const py = (v) => T + ph - (v / 100) * ph;

  const kids = [];
  for (let g = 0; g <= 4; g++) {
    const y = T + (ph / 4) * g;
    kids.push(h('line', { x1: L, y1: y, x2: W - R, y2: y, class: 'grid' }));
    kids.push(h('text', { x: L - 8, y: y + 3.5, 'text-anchor': 'end' }, String(100 - g * 25)));
  }

  const line = withData.map((p, i) => `${i ? 'L' : 'M'} ${px(p.i).toFixed(1)} ${py(p.pct).toFixed(1)}`).join(' ');
  const first = withData[0], last = withData[withData.length - 1];
  kids.push(h('path', {
    d: `${line} L ${px(last.i)} ${T + ph} L ${px(first.i)} ${T + ph} Z`, class: 'area',
  }));
  kids.push(h('path', { d: line, class: 'ln' }));
  for (const p of withData) {
    kids.push(h('circle', { cx: px(p.i), cy: py(p.pct), r: 3, class: 'pt' }));
    kids.push(h('title', {}, `${dateShort(p.at)} · ${p.right}/${p.done} · ${p.pct}%`));
  }

  for (const idx of [0, Math.floor(days.length / 2), days.length - 1]) {
    kids.push(h('text', { x: px(idx), y: H - 8, 'text-anchor': idx === 0 ? 'start' : idx === days.length - 1 ? 'end' : 'middle' },
      dateShort(days[idx].at)));
  }

  return h('svg.spark', {
    viewBox: `0 0 ${W} ${H}`, style: { height: 'auto' }, role: 'img',
    'aria-label': 'Daily accuracy over the last 30 days',
  }, kids);
}
