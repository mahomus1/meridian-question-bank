/* Test history. */

import { h, fill } from '../core/dom.js';
import * as store from '../core/store.js';
import { go } from '../core/router.js';
import { n, pct, clock, dateShort, timeShort, ago } from '../core/fmt.js';
import { confirm } from '../features/overlay.js';
import { empty, statusPip } from './parts.js';

export default async function tests() {
  const el = h('div.wrap');
  const host = h('div.panel');
  el.appendChild(host);

  function scoreOf(t) {
    const answered = t.qids.filter((q) => t.locked[q]);
    const right = answered.filter((q) => store.answerFor(q)?.ok).length;
    return {
      answered: answered.length,
      right,
      score: t.qids.length ? Math.round((right / t.qids.length) * 100) : 0,
    };
  }

  function draw() {
    const list = store.state.tests;
    fill(host,
      h('div.panel__head',
        h('h2', 'Test history'),
        h('div.panel__act',
          list.length
            ? h('button.btn.btn--sm.btn--danger', {
              onclick: async () => {
                const ok = await confirm({
                  title: 'Clear test history?',
                  desc: 'Your answers and notes are kept — only the test records are removed.',
                  ok: 'Clear history', danger: true,
                });
                if (!ok) return;
                store.state.tests.length = 0;
                store.flush();
                draw();
              },
            }, 'Clear history')
            : null,
          h('button.btn.btn--sm.btn--primary', { onclick: () => go('/create') }, 'New test'))),

      list.length
        ? h('div.table-wrap',
          h('table.dtable',
            h('thead', h('tr',
              h('th', 'Test'),
              h('th', 'Mode'),
              h('th.c', 'Items'),
              h('th.c', 'Score'),
              h('th.r', 'Time'),
              h('th.r', 'When'),
              h('th', ''))),
            h('tbody', list.map((t) => {
              const s = scoreOf(t);
              const done = t.status === 'done';
              return h('tr', {
                style: { cursor: 'pointer' },
                onclick: () => go(done ? `/results/${t.id}` : `/test/${t.id}`),
              },
                h('td',
                  h('div.row', { style: { gap: '8px' } },
                    done ? statusPip(s.score >= 60 ? 'correct' : 'incorrect')
                      : h('span.badge.badge--blue', 'In progress'),
                    h('span.qrow-topic', t.name))),
                h('td.sm.muted', t.mode === 'tutor' ? 'Tutor' : 'Timed'),
                h('td.c.num', t.qids.length),
                h('td.c.num', done ? h('b', pct(s.score)) : `${s.answered}/${t.qids.length}`),
                h('td.r.num.muted', clock(t.elapsed || 0)),
                h('td.r.sm.muted', { title: `${dateShort(t.startedAt)} ${timeShort(t.startedAt)}` }, ago(t.startedAt)),
                h('td.r',
                  h('button.btn.btn--sm.btn--ghost', {
                    title: 'Delete this test',
                    onclick: async (ev) => {
                      ev.stopPropagation();
                      const ok = await confirm({
                        title: 'Delete this test?',
                        desc: 'Answers you recorded are kept in your overall statistics.',
                        ok: 'Delete', danger: true,
                      });
                      if (ok) { store.deleteTest(t.id); draw(); }
                    },
                  }, '✕')));
            }))))
        : empty({
          mark: '◷', title: 'No tests yet',
          text: 'Assemble your first test and it will appear here with its score.',
          action: h('button.btn.btn--primary', { onclick: () => go('/create') }, 'Create a test'),
        }));
  }

  draw();

  const done = store.state.tests.filter((t) => t.status === 'done').length;
  return {
    title: 'Test history',
    subtitle: store.state.tests.length
      ? `${n(store.state.tests.length)} tests · ${n(done)} completed`
      : 'Nothing recorded yet',
    el,
  };
}
