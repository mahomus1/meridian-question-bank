/* Overview: where a session starts. */

import { h } from '../core/dom.js';
import * as store from '../core/store.js';
import { bank, filterItems } from '../core/bank.js';
import { go } from '../core/router.js';
import { n, pct, greeting, ago, duration, plural } from '../core/fmt.js';
import { ring, barRow, empty, statBlock, sectionHead, sampleNotice } from './parts.js';

export default async function dashboard() {
  const o = store.overall();
  const cats = store.byCategory(bank.index);
  const total = bank.index.meta.total;
  const active = store.activeTest();
  const days = store.streak();
  const marked = Object.keys(store.state.marks).length;

  const el = h('div.wrap');

  /* hero */
  const weakest = bank.index.categories
    .map((c) => ({ c, s: cats[c.slug] }))
    .filter((x) => x.s.done >= 4)
    .sort((a, b) => a.s.pct - b.s.pct)[0];

  el.appendChild(h('div.dash-hero',
    h('div.hero-card',
      h('div.hero-card__top',
        h('div.grow',
          h('h2', `${greeting()}.`),
          h('p', o.done
            ? `You have worked through ${plural(o.done, 'item')} of ${n(total)}${days > 1 ? ` · ${days}-day streak` : ''}.`
            : 'Your bank is ready. Assemble a test to begin.')),
        ring(o.pct, { size: 78, label: 'correct' })),
      h('div.stat-grid',
        statBlock(n(o.done), 'Answered'),
        statBlock(o.done ? pct(o.pct) : '—', 'Correct'),
        statBlock(o.avgSec ? `${o.avgSec}s` : '—', 'Average pace'),
        statBlock(n(marked), 'Marked'))),

    h('div.col',
      active
        ? h('button.resume', { onclick: () => go(`/test/${active.id}`) },
          h('div.resume__i', '▸'),
          h('div.grow',
            h('b', 'Resume test in progress'),
            h('p', `${active.name} · item ${active.idx + 1} of ${active.qids.length}`)),
          h('span.btn.btn--sm', 'Continue'))
        : h('div.card.card--pad.col',
          h('div.label', 'Start'),
          h('p.sm.muted', 'Assemble a test from any mix of categories, difficulty, and prior performance.'),
          h('button.btn.btn--primary.btn--block', { onclick: () => go('/create') }, 'Create a test')),

      h('div.card.card--pad.col',
        h('div.label', 'Quick start'),
        h('div.col', { style: { gap: '6px' } },
          quick('40 unused items', 'Mixed categories, tutor mode', { pools: ['unused'] }, 40),
          quick('20 incorrect items', 'Revisit what you missed', { pools: ['incorrect'] }, 20),
          quick('Marked items', 'Everything you flagged', { pools: ['marked'] }, 25))),
    )));

  /* categories */
  el.appendChild(sectionHead('Categories', `${bank.index.categories.length} subjects · ${n(total)} items`,
    h('button.btn.btn--sm', { onclick: () => go('/browse') }, 'Browse bank')));

  el.appendChild(h('div.cat-grid',
    bank.index.categories.map((c) => {
      const s = cats[c.slug];
      return h('button.cat-card', {
        style: { '--cdot': c.dot },
        onclick: () => go(`/browse?cat=${c.slug}`),
      },
        h('div.cat-card__name', c.name),
        h('div.cat-card__blurb', c.blurb),
        h('div.meter.meter--sm',
          h('div.meter__fill', {
            style: {
              width: `${(s.done / s.total) * 100}%`,
              background: s.pct === null ? 'var(--ink-4)'
                : s.pct >= 70 ? '#3f8f5f' : s.pct >= 50 ? 'var(--blue)' : '#b45445',
            },
          })),
        h('div.cat-card__foot',
          h('span', h('b', n(s.done)), ` / ${n(s.total)}`),
          s.done ? h('span', '·') : null,
          s.done ? h('span', h('b', pct(s.pct)), ' correct') : null));
    })));

  /* insight + activity */
  const recent = store.state.attempts.slice(-8).reverse();

  el.appendChild(h('div', { style: { marginTop: '26px' } },
    h('div.perf-grid',
      h('div.panel',
        h('div.panel__head', h('h2', 'Performance by category')),
        h('div.panel__body',
          o.done
            ? bank.index.categories
              .filter((c) => cats[c.slug].done > 0)
              .sort((a, b) => cats[a.slug].pct - cats[b.slug].pct)
              .slice(0, 6)
              .map((c) => barRow({
                label: c.name,
                value: cats[c.slug].pct,
                peer: cats[c.slug].peerPct,
                sub: `${cats[c.slug].done} answered`,
              }))
            : empty({ title: 'Nothing measured yet', text: 'Answer a few items and your accuracy by category will appear here.' }))),

      h('div.panel',
        h('div.panel__head', h('h2', 'Recent activity'),
          h('div.panel__act', h('a.btn.btn--sm.btn--ghost', { href: '#/tests' }, 'All tests'))),
        h('div.panel__body.panel__body--flush',
          recent.length
            ? recent.map((a) => {
              const m = bank.byId.get(a.q);
              return h('div.act-row',
                h('div', { class: `act-row__m act-row__m--${a.ok ? 'pass' : 'fail'}` }, a.ok ? '✓' : '✕'),
                h('div.grow.truncate',
                  h('div.truncate', m ? m.topic : a.q),
                  h('div.xs.muted', m ? `${m.archetypeLabel} · ${m.id}` : '')),
                h('div.xs.muted', ago(a.at)));
            })
            : empty({ title: 'No activity yet', text: 'Your answered items will be listed here.' })))),

    h('div', { style: { marginTop: '20px' } },
      weakest
        ? h('div.notice',
          h('div', h('b', 'Where to focus. '),
            `${weakest.c.name} is your weakest category at ${pct(weakest.s.pct)} across ${plural(weakest.s.done, 'item')}. `,
            h('a', {
              href: '#/create', style: { color: 'var(--blue)', textDecoration: 'underline' },
              onclick: (ev) => { ev.preventDefault(); go(`/create?cat=${weakest.c.slug}`); },
            }, 'Build a test on it.')))
        : null),

    h('div', { style: { marginTop: '20px' } }, sampleNotice()),
  ));

  function quick(label, sub, filter, count) {
    const available = filterItems(filter).length;
    return h('button.pool-card', {
      disabled: !available,
      style: { borderRadius: 'var(--r)' },
      onclick: () => go(`/create?preset=${encodeURIComponent(JSON.stringify({ ...filter, count }))}`),
    },
      h('b', label),
      h('span', available ? `${n(available)} available · ${sub}` : 'None available'));
  }

  return {
    title: 'Overview',
    subtitle: o.done
      ? `${n(o.done)} answered · ${pct(o.pct)} correct · ${duration(o.totalMs)} studied`
      : 'A board-style bank of 1,000 sample items',
    actions: [
      h('button.btn.btn--primary', { onclick: () => go('/create') }, 'Create test'),
    ],
    el,
  };
}
