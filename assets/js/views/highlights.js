/* Every highlight in the bank, in one place.

   Highlights are stored as offsets against a question's text, so the passage
   itself has to be resolved by loading the item body. They are grouped by
   question and can be sent to the notebook or removed without opening the item. */

import { h, fill } from '../core/dom.js';
import * as store from '../core/store.js';
import { meta, cat, getQuestion, loadCategory } from '../core/bank.js';
import { go } from '../core/router.js';
import { n } from '../core/fmt.js';
import { COLORS } from '../features/highlight.js';
import { clipText, targetLabel, chooseTarget } from '../features/capture.js';
import { toast, confirm } from '../features/overlay.js';
import { catTag, empty } from './parts.js';

export default async function highlights() {
  const el = h('div.wrap');
  const host = h('div');
  el.appendChild(host);

  let colourFilter = null;
  let catFilter = null;
  let query = '';

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
    const items = store.highlightsFor(qid).map((hl) => ({
      hl,
      text: (blocks[hl.b] || '').slice(hl.s, hl.e) || '(passage no longer present)',
    }));
    groups.push({ qid, m: meta(qid), items });
  }
  groups.sort((a, b) => a.qid.localeCompare(b.qid));

  function draw() {
    const shown = groups
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => {
          if (colourFilter && it.hl.c !== colourFilter) return false;
          if (query && !it.text.toLowerCase().includes(query.toLowerCase())) return false;
          return true;
        }),
      }))
      .filter((g) => g.items.length && (!catFilter || g.m.cat === catFilter));

    const total = shown.reduce((s, g) => s + g.items.length, 0);
    const dest = targetLabel(shown[0]?.qid);

    fill(host,
      h('div.row.row--wrap', { style: { gap: '8px', marginBottom: '16px' } },
        h('div.search', { style: { width: '240px' } },
          h('input.input', {
            type: 'search', placeholder: 'Search highlighted text…', value: query,
            oninput: (ev) => { query = ev.target.value; draw(); },
          })),
        h('div.row', { style: { gap: '5px' } },
          COLORS.map((c) => h('button.chip', {
            'aria-pressed': String(colourFilter === c.id),
            onclick: () => { colourFilter = colourFilter === c.id ? null : c.id; draw(); },
          },
            h('span.chip__dot', { style: { background: `var(${c.var})` } }),
            c.label))),
        h('select.select', {
          style: { width: 'auto' },
          onchange: (ev) => { catFilter = ev.target.value || null; draw(); },
        },
          h('option', { value: '' }, 'All categories'),
          [...new Set(groups.map((g) => g.m.cat))].map((slug) => h('option', {
            value: slug, selected: catFilter === slug,
          }, cat(slug)?.name || slug))),
        h('div.push.row', { style: { gap: '8px' } },
          h('span.xs.muted', `${n(total)} of ${n(groups.reduce((s, g) => s + g.items.length, 0))}`),
          h('button.btn.btn--sm', {
            onclick: () => chooseTarget({ onPick: () => draw() }),
            title: 'Change where passages are saved',
          }, `Saving to: ${dest.title}`))),

      shown.length
        ? h('div.stack-12', shown.map((g) => h('div.panel',
          h('div.panel__head',
            h('span.item-head__id', g.qid),
            catTag(g.m.cat),
            h('span.xs.muted.truncate', g.m.topic),
            h('div.panel__act',
              h('button.btn.btn--sm', { onclick: () => go(`/browse/${g.qid}`) }, 'Open item'))),
          h('div.panel__body.stack-8',
            g.items.map(({ hl, text }) => h('div.hl-row',
              h('span.hl-row__bar', { style: { background: `var(--hl-${hl.c})` } }),
              h('p.hl-row__t.grow', text),
              h('div.hl-row__act',
                h('button.btn.btn--sm', {
                  onclick: () => {
                    const note = clipText({ qid: g.qid, text, source: 'Highlight', color: hl.c });
                    if (note) store.updateHighlight(g.qid, hl.id, { note: note.id });
                    draw();
                  },
                }, 'To notebook'),
                h('button.btn.btn--sm.btn--ghost', {
                  title: 'Remove this highlight',
                  onclick: () => {
                    store.removeHighlight(g.qid, hl.id);
                    const gi = groups.find((x) => x.qid === g.qid);
                    if (gi) gi.items = gi.items.filter((x) => x.hl.id !== hl.id);
                    draw();
                  },
                }, '✕'))))))))
        : empty({ title: 'Nothing matches', text: 'Loosen the filters or clear the search.' }));
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

/** Map every highlightable block id in an item to its plain text. */
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
