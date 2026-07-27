/* Test assembly.

   Every control narrows the same pool, and the count in the summary updates on
   each change, so it is never a surprise how many items a configuration yields.
   The primary action is disabled — with the reason stated — rather than failing
   after the fact. */

import { h, fill } from '../core/dom.js';
import * as store from '../core/store.js';
import { bank, filterItems, pickQuestions, POOLS, prefetch } from '../core/bank.js';
import { go } from '../core/router.js';
import { n, secs } from '../core/fmt.js';
import { toast } from '../features/overlay.js';
import { diffPips } from './parts.js';

export default async function create({ query }) {
  const cfg = {
    mode: 'tutor',
    pools: ['unused'],
    cats: [],
    diffs: [],
    archetypes: [],
    count: 20,
    timed: false,
    timerSecs: store.prefs().timerSecs || 90,
    shuffle: true,
  };

  // Entry points from elsewhere: ?cat=slug or ?preset={json}
  if (query?.cat && bank.categories.has(query.cat)) cfg.cats = [query.cat];
  if (query?.preset) {
    try {
      const p = JSON.parse(query.preset);
      if (p.pools) cfg.pools = p.pools;
      if (p.cats) cfg.cats = p.cats;
      if (p.count) cfg.count = p.count;
    } catch { /* a malformed preset just falls back to defaults */ }
  }

  const el = h('div.wrap');
  const summaryHost = h('aside');
  const bodyHost = h('div.card', { style: { padding: '20px 22px' } });

  el.appendChild(h('div.builder', bodyHost, summaryHost));

  /* ── current pool ───────────────────────────────────────────────────── */

  const poolFilter = () => ({
    pools: cfg.pools, cats: cfg.cats, diffs: cfg.diffs, archetypes: cfg.archetypes,
  });
  const available = () => filterItems(poolFilter()).length;

  /* ── sections ───────────────────────────────────────────────────────── */

  function drawBody() {
    const avail = available();
    fill(bodyHost,
      /* mode */
      h('section.bsec',
        h('div.bsec__head', h('h3', 'Mode')),
        h('div.mode-grid',
          modeCard('tutor', 'Tutor', 'The explanation opens as soon as you answer each item. Best for learning.'),
          modeCard('timed', 'Timed exam', 'Answers are locked in and everything is revealed at the end. Best for pacing.'))),

      /* pool */
      h('section.bsec',
        h('div.bsec__head',
          h('h3', 'Question pool'),
          h('p', 'Combine as many as you like'),
          h('span.bsec__n', `${n(avail)} available`)),
        h('div.pool-grid', POOLS.map(poolCard))),

      /* categories */
      h('section.bsec',
        h('div.bsec__head',
          h('h3', 'Categories'),
          h('p', cfg.cats.length ? `${cfg.cats.length} selected` : 'All categories'),
          h('div.bsec__n',
            h('button.btn.btn--sm.btn--ghost', {
              onclick: () => { cfg.cats = cfg.cats.length ? [] : bank.index.categories.map((c) => c.slug); redraw(); },
            }, cfg.cats.length ? 'Clear' : 'Select all'))),
        h('div.row.row--wrap', { style: { gap: '6px' } },
          bank.index.categories.map((c) => {
            const count = filterItems({ ...poolFilter(), cats: [c.slug] }).length;
            const on = cfg.cats.includes(c.slug);
            return h('button.chip', {
              type: 'button', 'aria-pressed': String(on), disabled: !count && !on,
              onclick: () => { toggle(cfg.cats, c.slug); redraw(); },
            },
              h('span.chip__dot', { style: { background: c.dot } }),
              c.name,
              h('span.chip__n', n(count)));
          }))),

      /* difficulty */
      h('section.bsec',
        h('div.bsec__head',
          h('h3', 'Difficulty'),
          h('p', 'Banded by how often readers answer correctly'),
          h('span.bsec__n', cfg.diffs.length ? `${cfg.diffs.length} selected` : 'All bands')),
        h('div.row.row--wrap', { style: { gap: '6px' } },
          bank.index.meta.bands.map((b) => {
            const count = filterItems({ ...poolFilter(), diffs: [b.id] }).length;
            const on = cfg.diffs.includes(b.id);
            return h('button.chip', {
              type: 'button', 'aria-pressed': String(on), disabled: !count && !on,
              onclick: () => { toggle(cfg.diffs, b.id); redraw(); },
              title: b.min ? `${b.min}% and above answer correctly` : 'Under 48% answer correctly',
            },
              diffPips(b.id, { withName: false }),
              b.label,
              h('span.chip__n', n(count)));
          }))),

      /* question type */
      h('section.bsec',
        h('div.bsec__head',
          h('h3', 'Question type'),
          h('p', 'What the item asks you to do'),
          h('span.bsec__n', cfg.archetypes.length ? `${cfg.archetypes.length} selected` : 'All types')),
        h('div.row.row--wrap', { style: { gap: '6px' } },
          bank.index.meta.archetypes.map((a) => {
            const count = filterItems({ ...poolFilter(), archetypes: [a.id] }).length;
            const on = cfg.archetypes.includes(a.id);
            return h('button.chip', {
              type: 'button', 'aria-pressed': String(on), disabled: !count && !on,
              onclick: () => { toggle(cfg.archetypes, a.id); redraw(); },
            }, a.label, h('span.chip__n', n(count)));
          }))),

      /* length & timing */
      h('section.bsec',
        h('div.bsec__head', h('h3', 'Length and timing')),
        h('div.col', { style: { gap: '18px' } },
          countControl(avail),
          timingControl())),
    );
  }

  function modeCard(id, title, desc) {
    return h('button.mode-card', {
      type: 'button', 'aria-pressed': String(cfg.mode === id),
      onclick: () => {
        cfg.mode = id;
        cfg.timed = id === 'timed';
        redraw();
      },
    },
      h('b', title, cfg.mode === id ? h('span.badge.badge--blue', 'Selected') : null),
      h('span', desc));
  }

  function poolCard(p) {
    const count = filterItems({ ...poolFilter(), pools: [p.id] }).length;
    const on = cfg.pools.includes(p.id);
    return h('button.pool-card', {
      type: 'button', 'aria-pressed': String(on), disabled: !count && !on,
      onclick: () => {
        if (p.id === 'all') cfg.pools = on ? [] : ['all'];
        else { cfg.pools = cfg.pools.filter((x) => x !== 'all'); toggle(cfg.pools, p.id); }
        if (!cfg.pools.length) cfg.pools = ['all'];
        redraw();
      },
    }, h('b', p.label), h('span', `${n(count)} · ${p.hint}`));
  }

  function countControl(avail) {
    const max = Math.min(avail, 200);
    if (cfg.count > max) cfg.count = max;
    const input = h('input.range', {
      type: 'range', min: 1, max: Math.max(1, max), value: cfg.count,
      disabled: !max,
      style: { '--fill': `${max ? (cfg.count / max) * 100 : 0}%` },
      oninput: (ev) => {
        cfg.count = Number(ev.target.value);
        ev.target.style.setProperty('--fill', `${(cfg.count / max) * 100}%`);
        countLabel.textContent = String(cfg.count);
        drawSummary();
      },
    });
    const countLabel = h('b', String(cfg.count));

    return h('div.field',
      h('div.row',
        h('span.label', 'Number of questions'),
        h('div.push.row', { style: { gap: '6px' } },
          [10, 20, 40].filter((x) => x <= max).map((x) => h('button.btn.btn--sm', {
            onclick: () => { cfg.count = x; redraw(); },
          }, x)),
          max > 40 && h('button.btn.btn--sm', { onclick: () => { cfg.count = max; redraw(); } }, `Max ${max}`))),
      h('div.row',
        h('div.grow', input),
        h('div', { style: { minWidth: '52px', textAlign: 'right', fontSize: '19px', fontWeight: 620 } }, countLabel)),
      h('div.field__hint', max
        ? `Up to ${n(max)} from the current pool${avail > 200 ? ' (capped at 200 per test)' : ''}.`
        : 'No questions match the current filters.'));
  }

  function timingControl() {
    return h('div.col', { style: { gap: '12px' } },
      h('label.switch',
        h('input', {
          type: 'checkbox', checked: cfg.timed,
          onchange: (ev) => { cfg.timed = ev.target.checked; redraw(); },
        }),
        h('span.switch__track'),
        h('div.set-row__t',
          h('b', 'Timed'),
          h('span', cfg.timed
            ? `${secs(cfg.timerSecs)} per question · ${secs(cfg.timerSecs * cfg.count)} total`
            : 'No clock — work at your own pace'))),

      cfg.timed && h('div.field',
        h('span.label', 'Seconds per question'),
        h('div.seg',
          [60, 75, 90, 120].map((s) => h('button', {
            type: 'button', 'aria-pressed': String(cfg.timerSecs === s),
            onclick: () => { cfg.timerSecs = s; store.setPref('timerSecs', s); redraw(); },
          }, `${s}s`)))),

      h('label.check',
        h('input', {
          type: 'checkbox', checked: cfg.shuffle,
          onchange: (ev) => { cfg.shuffle = ev.target.checked; },
        }),
        h('span.check__box'),
        h('span', 'Shuffle question order')));
  }

  /* ── summary ────────────────────────────────────────────────────────── */

  function drawSummary() {
    const avail = available();
    const count = Math.min(cfg.count, avail);
    const blocked = !avail ? 'No questions match these filters.'
      : count < 1 ? 'Choose at least one question.' : null;

    const catLabel = cfg.cats.length
      ? (cfg.cats.length === bank.index.categories.length ? 'All categories'
        : cfg.cats.length <= 2 ? cfg.cats.map((s) => bank.categories.get(s).name).join(', ')
          : `${cfg.cats.length} categories`)
      : 'All categories';

    fill(summaryHost, h('div.summary',
      h('div.summary__head',
        h('div.label', { style: { marginBottom: '4px' } }, 'Your test'),
        h('div.summary__n', n(count), h('small', ` question${count === 1 ? '' : 's'}`))),
      h('dl.summary__body',
        row('Mode', cfg.mode === 'tutor' ? 'Tutor' : 'Timed exam'),
        row('Pool', cfg.pools.includes('all') ? 'Entire bank'
          : cfg.pools.map((p) => POOLS.find((x) => x.id === p)?.label).join(', ')),
        row('Categories', catLabel),
        row('Difficulty', cfg.diffs.length ? cfg.diffs.map((d) => bank.index.meta.bands.find((b) => b.id === d).label).join(', ') : 'All bands'),
        row('Type', cfg.archetypes.length ? `${cfg.archetypes.length} selected` : 'All types'),
        row('Timing', cfg.timed ? `${secs(cfg.timerSecs)} each` : 'Untimed'),
        cfg.timed ? row('Est. duration', secs(cfg.timerSecs * count)) : null,
        row('Order', cfg.shuffle ? 'Shuffled' : 'Bank order')),
      h('div.summary__foot',
        blocked && h('div.summary__warn', h('span', '△'), h('span', blocked)),
        h('button.btn.btn--primary.btn--lg.btn--block', {
          disabled: !!blocked,
          onclick: () => launch(count),
        }, 'Begin test'),
        h('button.btn.btn--block', {
          onclick: () => { Object.assign(cfg, { pools: ['unused'], cats: [], diffs: [], archetypes: [], count: 20 }); redraw(); },
        }, 'Reset filters'))));

    function row(k, v) {
      return v === null ? null : h('div.summary__row', h('dt', k), h('dd', v));
    }
  }

  /* ── launch ─────────────────────────────────────────────────────────── */

  async function launch(count) {
    const items = filterItems(poolFilter());
    if (!items.length) { toast('No questions match these filters.'); return; }
    const qids = pickQuestions(items, count, cfg.shuffle);

    const nameBits = [];
    if (cfg.cats.length === 1) nameBits.push(bank.categories.get(cfg.cats[0]).name);
    else if (cfg.cats.length > 1) nameBits.push(`${cfg.cats.length} categories`);
    else nameBits.push('Mixed');
    nameBits.push(`${qids.length} items`);

    const test = store.createTest({
      name: nameBits.join(' · '),
      mode: cfg.mode,
      timerSecs: cfg.timed ? cfg.timerSecs : 0,
      qids,
      config: { ...cfg },
    });

    await prefetch(qids.slice(0, 12));
    go(`/test/${test.id}`);
  }

  /* ── wiring ─────────────────────────────────────────────────────────── */

  function toggle(arr, v) {
    const i = arr.indexOf(v);
    if (i < 0) arr.push(v); else arr.splice(i, 1);
  }

  function redraw() { drawBody(); drawSummary(); }
  redraw();

  return {
    title: 'Create a test',
    subtitle: 'Choose how you want to work, then narrow the pool — the count updates as you go',
    el,
  };
}
