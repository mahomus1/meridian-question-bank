/* Every highlight in the bank, in one place.

   Highlights are stored as offsets against a question's text, so the passage
   itself has to be resolved by loading the item body. They are grouped by
   question and listed in the order they appear inside it, each row naming the
   section it came from and when it was made. They can be sent to the notebook
   or removed without opening the item. */

import { h, fill } from '../core/dom.js';
import * as store from '../core/store.js';
import { meta, cat, getQuestion, loadCategory } from '../core/bank.js';
import { go } from '../core/router.js';
import { n, ago } from '../core/fmt.js';
import { COLORS, sourceLabel } from '../features/highlight.js';
import { clipText, activeNote } from '../features/capture.js';
import { toast, confirm } from '../features/overlay.js';
import { catTag, empty } from './parts.js';

export default async function highlights() {
  const el = h('div.wrap');
  const host = h('div');
  el.appendChild(host);

  let colourFilter = null;
  let catFilter = null;
  let query = '';
  let order = store.prefs().hlOrder || 'item';

  const qids = Object.keys(store.state.highlights)
    .filter((id) => store.highlightsFor(id).length && meta(id));

  if (!qids.length) {
    fill(host, empty({
      mark: '▤', title: 'No highlights yet',
      text: 'Select any passage in a vignette or explanation to mark it. Everything you highlight collects here.',
      action: h('button.btn.btn--primary', { onclick: () => go('/browse') }, 'Open the question bank'),
    }));
    return { title: 'Highlights', el };
  }

  // Resolve the passages: load each category once, then slice the stored range
  // out of the block's plain text.
  const slugs = [...new Set(qids.map((id) => meta(id).cat))];
  await Promise.all(slugs.map((s) => loadCategory(s).catch(() => null)));

  const groups = [];
  for (const qid of qids) {
    let q;
    try { q = await getQuestion(qid); } catch { continue; }
    const blocks = blockText(q);
    const flow = Object.keys(blocks);
    const items = store.highlightsFor(qid).map((hl) => ({
      hl,
      pos: flow.indexOf(hl.b),
      text: (blocks[hl.b] || '').slice(hl.s, hl.e) || '(passage no longer present)',
    }));
    groups.push({ qid, m: meta(qid), items });
  }

  const latest = (g) => g.items.reduce((m, it) => Math.max(m, it.hl.at || 0), 0);

  /* The count in the page header has to follow removals, or it keeps
     announcing passages that are no longer there. */
  function syncSubtitle() {
    const total = groups.reduce((s, g) => s + g.items.length, 0);
    const live = groups.filter((g) => g.items.length).length;
    const p = document.querySelector('.topbar__title p');
    if (p) p.textContent = `${n(total)} passages across ${n(live)} items`;
  }

  function draw() {
    // A group survives a query that names its topic or id, so the reader can
    // search the way they think — "asthma" — not only by highlighted words.
    const q = query.trim().toLowerCase();
    const scoped = groups
      .map((g) => {
        const groupHit = q && `${g.m.topic} ${g.qid}`.toLowerCase().includes(q);
        return {
          ...g,
          items: g.items.filter((it) => !q || groupHit || it.text.toLowerCase().includes(q)),
        };
      })
      .filter((g) => g.items.length && (!catFilter || g.m.cat === catFilter));

    // Each chip's count is what pressing it would leave on screen.
    const byColour = {};
    for (const g of scoped) for (const it of g.items) byColour[it.hl.c] = (byColour[it.hl.c] || 0) + 1;

    const shown = scoped
      .map((g) => ({ ...g, items: g.items.filter((it) => !colourFilter || it.hl.c === colourFilter) }))
      .filter((g) => g.items.length);

    for (const g of shown) {
      g.items.sort(order === 'recent'
        ? (a, b) => (b.hl.at || 0) - (a.hl.at || 0)
        : (a, b) => (a.pos - b.pos) || (a.hl.s - b.hl.s));
    }
    shown.sort(order === 'recent'
      ? (a, b) => latest(b) - latest(a)
      : (a, b) => a.qid.localeCompare(b.qid));

    const total = shown.reduce((s, g) => s + g.items.length, 0);
    const all = groups.reduce((s, g) => s + g.items.length, 0);

    fill(host,
      h('div.row.row--wrap', { style: { gap: '8px', marginBottom: '16px' } },
        h('div.search', { style: { width: '240px' } },
          h('input.input', {
            type: 'search', placeholder: 'Search highlights…', value: query,
            oninput: (ev) => { query = ev.target.value; draw(); },
          })),
        h('div.row', { style: { gap: '5px' } },
          COLORS.map((c) => h('button.chip', {
            'aria-pressed': String(colourFilter === c.id),
            disabled: !byColour[c.id] && colourFilter !== c.id,
            onclick: () => { colourFilter = colourFilter === c.id ? null : c.id; draw(); },
          },
            h('span.chip__dot', { style: { background: `var(${c.var})` } }),
            c.label,
            byColour[c.id] ? h('span.chip__n', n(byColour[c.id])) : null))),
        h('select.select', {
          style: { width: 'auto' },
          'aria-label': 'Category',
          onchange: (ev) => { catFilter = ev.target.value || null; draw(); },
        },
          h('option', { value: '' }, 'All categories'),
          [...new Set(groups.map((g) => g.m.cat))].map((slug) => h('option', {
            value: slug, selected: catFilter === slug,
          }, cat(slug)?.name || slug))),
        h('div.push.row', { style: { gap: '8px' } },
          h('span.xs.muted', `${n(total)} of ${n(all)}`),
          h('select.select', {
            style: { width: 'auto' },
            'aria-label': 'Order',
            onchange: (ev) => { order = ev.target.value; store.setPref('hlOrder', order); draw(); },
          },
            h('option', { value: 'item', selected: order === 'item' }, 'In item order'),
            h('option', { value: 'recent', selected: order === 'recent' }, 'Newest first')))),

      shown.length
        ? h('div.stack-12', shown.map((g) => h('div.panel',
          h('div.panel__head',
            h('span.item-head__id', g.qid),
            catTag(g.m.cat),
            h('span.xs.muted.truncate', g.m.topic),
            h('div.panel__act',
              h('span.xs.muted.num', n(g.items.length)),
              h('button.btn.btn--sm', {
                onclick: () => go(`/browse/${g.qid}?from=highlights`),
              }, 'Open item'))),
          h('div.panel__body.stack-8', g.items.map((it) => row(g, it))))))
        : empty({ title: 'Nothing matches', text: 'Loosen the filters or clear the search.' }));
  }

  function row(g, it) {
    const { hl } = it;
    const linked = hl.note ? store.noteById(hl.note) : null;
    return h('div.hl-row',
      h('span.hl-row__bar', { style: { background: `var(--hl-${hl.c})` } }),
      h('div.grow.hl-row__main',
        // The passage is the link: it opens the item scrolled to this exact
        // mark, which is the only reason to keep a list of them.
        h('button.hl-row__t', {
          title: 'Open this passage in the item',
          onclick: () => go(`/browse/${g.qid}?hl=${encodeURIComponent(hl.id)}&from=highlights`),
        }, it.text),
        h('div.hl-row__meta',
          sourceLabel(hl.b),
          hl.at ? ` · ${ago(hl.at)}` : null,
          linked ? ' · in your notebook' : null)),
      h('div.hl-row__act',
        linked
          ? h('button.btn.btn--sm', { onclick: () => go(`/notebook/${linked.id}`) }, 'Open note')
          : h('button.btn.btn--sm', {
            onclick: () => {
              clipText({ qid: g.qid, text: it.text, source: sourceLabel(hl.b) });
              store.updateHighlight(g.qid, hl.id, { note: activeNote().id });
              draw();
            },
          }, 'To notebook'),
        h('button.btn.btn--sm.btn--ghost', {
          title: 'Remove this highlight',
          onclick: () => remove(g, it),
        }, '✕')));
  }

  /* Removal is one press, so it answers with an Undo rather than a dialog. */
  function remove(g, it) {
    const { hl } = it;
    store.removeHighlight(g.qid, hl.id);
    const live = groups.find((x) => x.qid === g.qid);
    if (live) live.items = live.items.filter((x) => x.hl.id !== hl.id);
    draw();
    syncSubtitle();
    toast('Highlight removed', {
      action: 'Undo',
      onAction: () => {
        const back = store.addHighlight(g.qid, {
          block: hl.b, start: hl.s, end: hl.e, color: hl.c,
          id: hl.id, at: hl.at, note: hl.note,
        });
        live?.items.push({ ...it, hl: back });
        draw();
        syncSubtitle();
      },
    });
  }

  draw();

  const totalAll = groups.reduce((s, g) => s + g.items.length, 0);
  return {
    title: 'Highlights',
    subtitle: `${n(totalAll)} passages across ${n(groups.length)} items`,
    actions: [
      h('button.btn.btn--sm.btn--danger', {
        onclick: async () => {
          const ok = await confirm({
            title: 'Clear every highlight?',
            desc: 'Passages already saved to your notebook are kept.',
            ok: 'Clear highlights', danger: true,
          });
          if (!ok) return;
          for (const g of groups) for (const it of g.items) store.removeHighlight(g.qid, it.hl.id);
          toast('Highlights cleared');
          go('/highlights');
        },
      }, 'Clear all'),
    ],
    el,
  };
}

/** Map every highlightable block id in an item to its plain text, in the
    order the blocks appear on the page. */
function blockText(q) {
  const out = {};
  q.stem.paras.forEach((p, i) => { out[`stem-${i}`] = p; });
  out.ask = q.ask;
  out.summary = q.teach.summary;
  q.teach.paras.forEach((p, i) => { out[`teach-${i}`] = p; });
  q.choices.forEach((c) => { out[`why-${c.k}`] = c.why; });
  out.objective = q.teach.objective;
  return out;
}
