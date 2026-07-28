/* The bank browser, and the single-item reader it opens into.

   The reader is also where a finished item is reviewed, so highlighting and
   note-taking work here exactly as they do mid-test. */

import { h, fill } from '../core/dom.js';
import * as store from '../core/store.js';
import { bank, filterItems, statusOf, getQuestion, meta, cat, POOLS } from '../core/bank.js';
import { go } from '../core/router.js';
import { n, pct } from '../core/fmt.js';
import { vignette, explanation, staticChoices } from '../render/item.js';
import { attachHighlighter, highlightSelection, hidePopover } from '../features/highlight.js';
import { clipFigure, clipTable, clipQuestion } from '../features/capture.js';
import { toast } from '../features/overlay.js';
import { diffPips, catTag, statusPip, empty } from './parts.js';

export default async function browse(params) {
  return params.id ? reader(params.id) : listing(params.query || {});
}

/* ══ listing ═══════════════════════════════════════════════════════════ */

async function listing(query) {
  const f = {
    cats: query.cat ? [query.cat] : [],
    diffs: [],
    pools: [],
    archetypes: [],
    query: '',
  };
  let sort = { key: 'id', dir: 1 };
  let limit = 60;

  const el = h('div.wrap.wrap--wide');
  const filtersHost = h('div.filters');
  const tableHost = h('div.panel');
  el.appendChild(h('div.browse', filtersHost, tableHost));

  function drawFilters() {
    fill(filtersHost,
      group('Status', POOLS.filter((p) => p.id !== 'all').map((p) => row(
        p.label, filterItems({ ...f, pools: [p.id] }).length,
        f.pools.includes(p.id), () => { toggle(f.pools, p.id); draw(); }))),

      group('Category', bank.index.categories.map((c) => row(
        c.name, filterItems({ ...f, cats: [c.slug] }).length,
        f.cats.includes(c.slug), () => { toggle(f.cats, c.slug); draw(); },
        h('span.dot', { style: { background: c.dot } })))),

      group('Difficulty', bank.index.meta.bands.map((b) => row(
        b.label, filterItems({ ...f, diffs: [b.id] }).length,
        f.diffs.includes(b.id), () => { toggle(f.diffs, b.id); draw(); },
        diffPips(b.id, { withName: false })))),

      group('Question type', bank.index.meta.archetypes.map((a) => row(
        a.label, filterItems({ ...f, archetypes: [a.id] }).length,
        f.archetypes.includes(a.id), () => { toggle(f.archetypes, a.id); draw(); }))),
    );

    function group(label, kids) {
      return h('div.filter-group', h('div.label', label), h('div.filter-list', kids));
    }
    function row(label, count, on, onclick, lead) {
      return h('button.filter-row', {
        type: 'button', 'aria-pressed': String(on), onclick, disabled: !count && !on,
      }, lead || null, h('span.truncate', label), h('small', n(count)));
    }
  }

  function drawTable() {
    let items = filterItems(f);
    const dir = sort.dir;
    items = items.slice().sort((a, b) => {
      const va = sort.key === 'pct' ? a.pct : sort.key === 'topic' ? a.topic : a.id;
      const vb = sort.key === 'pct' ? b.pct : sort.key === 'topic' ? b.topic : b.id;
      return va < vb ? -dir : va > vb ? dir : 0;
    });
    const shown = items.slice(0, limit);

    fill(tableHost,
      h('div.panel__head',
        h('div.search', { style: { width: '260px' } },
          h('input.input', {
            type: 'search', placeholder: 'Search topics and items…', value: f.query,
            oninput: (ev) => { f.query = ev.target.value; limit = 60; drawTable(); },
          })),
        h('div.panel__act',
          h('span.xs.muted', `${n(items.length)} of ${n(bank.index.meta.total)}`),
          anyFilter() && h('button.btn.btn--sm.btn--ghost', {
            onclick: () => {
              Object.assign(f, { cats: [], diffs: [], pools: [], archetypes: [], query: '' });
              draw();
            },
          }, 'Clear filters'),
          h('button.btn.btn--sm', {
            disabled: !items.length,
            onclick: () => {
              const t = store.createTest({
                name: `Custom · ${Math.min(items.length, 200)} items`,
                mode: 'tutor', timerSecs: 0,
                qids: items.slice(0, 200).map((i) => i.id),
                config: { ...f },
              });
              go(`/test/${t.id}`);
            },
          }, 'Test these'))),

      h('div.table-wrap',
        shown.length
          ? h('table.dtable',
            h('thead', h('tr',
              h('th', { style: { width: '28px' } }, ''),
              th('Item', 'id'),
              th('Topic', 'topic'),
              h('th', 'Category'),
              h('th', 'Type'),
              h('th', 'Difficulty'),
              th('Peers', 'pct'))),
            h('tbody', shown.map((it) => h('tr', {
              style: { cursor: 'pointer' },
              onclick: () => go(`/browse/${it.id}`),
            },
              h('td', statusPip(statusOf(it.id))),
              h('td.qrow-id', it.id),
              h('td',
                h('div.qrow-topic', it.topic),
                h('div.qrow-prev', it.preview)),
              h('td.sm', catTag(it.cat, { abbr: true })),
              h('td.sm.muted', it.archetypeLabel),
              h('td', diffPips(it.diff, { withName: false })),
              h('td.r.num.muted', `${it.pct}%`)))))
          : empty({ title: 'Nothing matches', text: 'Loosen the filters or clear the search.' })),

      shown.length < items.length
        ? h('div', { style: { padding: '12px', textAlign: 'center', borderTop: '1px solid var(--rule)' } },
          h('button.btn', { onclick: () => { limit += 100; drawTable(); } },
            `Show more — ${n(items.length - shown.length)} remaining`))
        : null,
    );

    function th(label, key) {
      const active = sort.key === key;
      return h('th.sortable', {
        'aria-sort': active ? (sort.dir === 1 ? 'ascending' : 'descending') : null,
        onclick: () => {
          if (active) sort.dir *= -1; else sort = { key, dir: 1 };
          drawTable();
        },
      }, label);
    }
  }

  const anyFilter = () => f.cats.length || f.diffs.length || f.pools.length
    || f.archetypes.length || f.query;

  function toggle(arr, v) {
    const i = arr.indexOf(v);
    if (i < 0) arr.push(v); else arr.splice(i, 1);
    limit = 60;
  }

  function draw() { drawFilters(); drawTable(); }
  draw();

  return {
    title: 'Question bank',
    subtitle: `${n(bank.index.meta.total)} items · ${bank.index.categories.length} categories`,
    el,
  };
}

/* ══ single item reader ════════════════════════════════════════════════ */

async function reader(id) {
  const m = meta(id);
  if (!m) {
    return {
      title: 'Item not found',
      el: h('div.wrap', empty({
        mark: '?', title: `No item with id ${id}`,
        action: h('a.btn.btn--primary', { href: '#/browse' }, 'Back to the bank'),
      })),
    };
  }

  const q = await getQuestion(id);
  const answer = store.answerFor(id);
  const marked = store.isMarked(id);
  let detach = null;

  const inner = h('div.runner__inner', { dataset: { hlRoot: id } },
    h('div.item-head',
      h('span.item-head__id', q.id),
      catTag(q.cat),
      h('span.badge.badge--outline', q.archetypeLabel),
      diffPips(q.diff),
      h('div.push.row', { style: { gap: '6px' } },
        h('button.btn.btn--sm', {
          'aria-pressed': String(marked),
          style: marked ? { color: 'var(--amber)', borderColor: 'var(--amber)' } : null,
          onclick: (ev) => {
            const on = store.toggleMark(id);
            ev.currentTarget.setAttribute('aria-pressed', String(on));
            ev.currentTarget.style.color = on ? 'var(--amber)' : '';
            ev.currentTarget.style.borderColor = on ? 'var(--amber)' : '';
            ev.currentTarget.textContent = on ? '★ Marked' : '☆ Mark';
          },
        }, marked ? '★ Marked' : '☆ Mark'),
        h('button.btn.btn--sm', { onclick: () => clipQuestion({ qid: id }) }, 'Save item'))),

    vignette(q),
    staticChoices(q, { picked: answer?.c || null, showPeer: store.prefs().showPeer }),
    explanation(q, {
      picked: answer?.c || null,
      mySec: answer ? Math.round((answer.ms || 0) / 1000) : 0,
      showPeer: store.prefs().showPeer,
      onClipFigure: () => clipFigure({ qid: id, spec: q.figure }),
      onClipTable: () => clipTable({ qid: id, spec: q.table }),
    }),
  );

  const el = h('div.runner',
    h('div.runner__bar',
      h('a.btn.btn--sm', { href: '#/browse' }, '← Question bank'),
      h('div.push.row', { style: { gap: '8px' } },
        neighbour(-1), neighbour(1))),
    h('div.runner__body', h('div.runner__main', inner)));

  function neighbour(step) {
    const list = bank.index.items;
    const i = list.findIndex((x) => x.id === id);
    const next = list[i + step];
    return h('button.btn.btn--sm', {
      disabled: !next,
      onclick: () => next && go(`/browse/${next.id}`),
    }, step < 0 ? '← Previous item' : 'Next item →');
  }

  const onKey = (ev) => {
    if (ev.target?.closest?.('.panel, .modal, .palette')) return;
    const t = document.activeElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (t?.closest?.('.panel, .modal, .palette')) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === 'h' || ev.key === 'H') { if (highlightSelection('yellow')) ev.preventDefault(); }
    if (ev.key === 'm' || ev.key === 'M') { store.toggleMark(id); toast(store.isMarked(id) ? 'Marked' : 'Unmarked'); }
  };
  document.addEventListener('keydown', onKey);

  return {
    title: q.topic,
    subtitle: `${cat(q.cat).name} · ${q.archetypeLabel} · ${q.peer.pct}% answered correctly`,
    // The shell's own Notebook toggle sits in this bar already, and it can shut
    // the panel as well as open it.
    actions: null,
    el,
    fixed: true,
    mounted() {
      detach = attachHighlighter(inner, { qid: id });
    },
    destroy() {
      document.removeEventListener('keydown', onKey);
      detach?.();
      hidePopover();
    },
  };
}
