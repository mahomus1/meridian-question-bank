/* Test results: the score, how it compares, and where it came from. */

import { h, fill } from '../core/dom.js';
import * as store from '../core/store.js';
import { bank, meta, cat } from '../core/bank.js';
import { go } from '../core/router.js';
import { n, pct, clock, duration, dateFull, timeShort } from '../core/fmt.js';
import { ring, barRow, diffPips, statusPip, empty, sectionHead } from './parts.js';

export default async function results({ id }) {
  const test = store.testById(id);
  if (!test) {
    return {
      title: 'Results',
      el: h('div.wrap', empty({
        mark: '?', title: 'That test no longer exists',
        action: h('a.btn.btn--primary', { href: '#/create' }, 'Create a new test'),
      })),
    };
  }

  const rows = test.qids.map((qid, i) => {
    const m = meta(qid);
    const pick = test.picks[qid] || null;
    const a = store.answerFor(qid);
    // The recorded answer belongs to this test only if it was locked here.
    const key = test.locked[qid] && a ? (a.ok ? pick : null) : null;
    return {
      i, qid, m, pick,
      ok: test.locked[qid] && a ? a.ok : (pick ? null : false),
      omitted: !pick,
      ms: test.spent[qid] || 0,
      keyLetter: key,
    };
  });

  const answered = rows.filter((r) => !r.omitted);
  const correct = answered.filter((r) => r.ok).length;
  const incorrect = answered.length - correct;
  const omitted = rows.length - answered.length;
  const score = rows.length ? Math.round((correct / rows.length) * 100) : 0;
  const peerAvg = Math.round(rows.reduce((s, r) => s + (r.m?.pct || 0), 0) / (rows.length || 1));
  const totalMs = test.elapsed || rows.reduce((s, r) => s + r.ms, 0);

  /* category and difficulty breakdown for this test only */
  const byCat = {};
  const byDiff = {};
  for (const r of rows) {
    if (!r.m) continue;
    const c = byCat[r.m.cat] || (byCat[r.m.cat] = { done: 0, right: 0, peer: 0 });
    c.done++; c.peer += r.m.pct; if (r.ok) c.right++;
    const d = byDiff[r.m.diff] || (byDiff[r.m.diff] = { done: 0, right: 0 });
    d.done++; if (r.ok) d.right++;
  }

  const el = h('div.wrap');

  el.appendChild(h('div.score-hero',
    ring(score, { size: 116, stroke: 9, label: 'score' }),
    h('div.col', { style: { gap: '14px' } },
      h('div',
        h('h2.h2', scoreLine(score, peerAvg)),
        h('p.sm.muted', `${test.name} · ${dateFull(test.startedAt)} at ${timeShort(test.startedAt)}`)),
      h('div.stat-grid',
        h('div.stat', h('div.stat__v', { style: { color: '#3f8f5f' } }, n(correct)), h('div.stat__k', 'Correct')),
        h('div.stat', h('div.stat__v', { style: { color: '#b45445' } }, n(incorrect)), h('div.stat__k', 'Incorrect')),
        h('div.stat', h('div.stat__v', n(omitted)), h('div.stat__k', 'Omitted')),
        h('div.stat', h('div.stat__v', clock(totalMs)), h('div.stat__k', 'Total time'))))));

  el.appendChild(h('div.perf-grid', { style: { marginBottom: '22px' } },
    h('div.panel',
      h('div.panel__head', h('h2', 'By category')),
      h('div.panel__body',
        Object.entries(byCat).length
          ? Object.entries(byCat)
            .sort((a, b) => (a[1].right / a[1].done) - (b[1].right / b[1].done))
            .map(([slug, s]) => barRow({
              label: cat(slug)?.name || slug,
              value: Math.round((s.right / s.done) * 100),
              peer: Math.round(s.peer / s.done),
              sub: `${s.right}/${s.done}`,
            }))
          : empty({ title: 'No data' }))),

    h('div.panel',
      h('div.panel__head', h('h2', 'By difficulty')),
      h('div.panel__body',
        bank.index.meta.bands
          .filter((b) => byDiff[b.id])
          .map((b) => {
            const s = byDiff[b.id];
            return barRow({
              label: b.label,
              value: Math.round((s.right / s.done) * 100),
              sub: `${s.right}/${s.done}`,
            });
          })))));

  /* item review table */
  let filter = 'all';
  const tableHost = h('div.panel');

  function drawTable() {
    const shown = rows.filter((r) => filter === 'all'
      || (filter === 'incorrect' && r.ok === false && !r.omitted)
      || (filter === 'correct' && r.ok === true)
      || (filter === 'omitted' && r.omitted)
      || (filter === 'marked' && store.isMarked(r.qid)));

    fill(tableHost,
      h('div.panel__head',
        h('h2', 'Item review'),
        h('div.panel__act',
          h('div.seg',
            [['all', 'All'], ['incorrect', 'Incorrect'], ['correct', 'Correct'],
              ['omitted', 'Omitted'], ['marked', 'Marked']].map(([k, label]) => h('button', {
              type: 'button', 'aria-pressed': String(filter === k),
              onclick: () => { filter = k; drawTable(); },
            }, label))))),
      h('div.table-wrap',
        shown.length
          ? h('table.dtable',
            h('thead', h('tr',
              h('th', { style: { width: '38px' } }, '#'),
              h('th', ''),
              h('th', 'Item'),
              h('th', 'Category'),
              h('th', 'Difficulty'),
              h('th.c', 'You'),
              h('th.c', 'Key'),
              h('th.r', 'Time'),
              h('th.r', 'Peers'))),
            h('tbody', shown.map((r) => h('tr', {
              style: { cursor: 'pointer' },
              onclick: () => go(`/browse/${r.qid}`),
            },
              h('td.muted.num', r.i + 1),
              h('td', statusPip(r.omitted ? 'unused' : r.ok ? 'correct' : 'incorrect')),
              h('td',
                h('div.qrow-topic', r.m?.topic || r.qid),
                h('div.qrow-prev', r.m?.archetypeLabel || '')),
              h('td.sm', r.m ? cat(r.m.cat)?.abbr : '—'),
              h('td', r.m ? diffPips(r.m.diff, { withName: false }) : '—'),
              h('td.c.mono', r.pick || '—'),
              h('td.c.mono', r.ok === true ? r.pick : (r.m ? keyOf(r.qid) : '—')),
              h('td.r.num', r.ms ? `${Math.round(r.ms / 1000)}s` : '—'),
              h('td.r.num.muted', r.m ? `${r.m.pct}%` : '—')))))
          : empty({ title: 'Nothing in this view' })));
  }

  // The key letter lives in the item body; for the table we only need it when
  // the reader was wrong, and the stored answer tells us the rest.
  function keyOf(qid) {
    const a = store.answerFor(qid);
    return a && a.ok ? a.c : '·';
  }

  drawTable();
  el.appendChild(sectionHead('Review', 'Open any item to read the full explanation'));
  el.appendChild(tableHost);

  function scoreLine(s, peer) {
    if (!answered.length) return 'No items answered';
    const delta = s - peer;
    if (Math.abs(delta) < 3) return `${pct(s)} — in line with the peer average`;
    return delta > 0
      ? `${pct(s)} — ${delta} points above the peer average`
      : `${pct(s)} — ${Math.abs(delta)} points below the peer average`;
  }

  return {
    title: 'Results',
    subtitle: `${test.name} · ${duration(totalMs)}`,
    actions: [
      incorrect
        ? h('button.btn', {
          onclick: () => {
            const wrong = rows.filter((r) => r.ok === false).map((r) => r.qid);
            const t = store.createTest({
              name: `Retry · ${wrong.length} items`,
              mode: 'tutor', timerSecs: 0, qids: wrong,
              config: { retryOf: test.id },
            });
            go(`/test/${t.id}`);
          },
        }, `Retry ${incorrect} incorrect`)
        : null,
      h('button.btn.btn--primary', { onclick: () => go('/create') }, 'New test'),
    ].filter(Boolean),
    el,
  };
}
