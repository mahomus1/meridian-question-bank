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
import { clipText, clipPassage, activeNote } from '../features/capture.js';
import { toast, confirm } from '../features/overlay.js';
import {
  isLibraryKey, topicIdFromKey, topicMeta, getTopic, loadChapter,
  topicBlocks, blockSection, chapter,
} from '../core/library.js';
import { catTag, empty } from './parts.js';

export default async function highlights() {
  const el = h('div.wrap');
  const host = h('div');
  el.appendChild(host);

  let colourFilter = null;
  let catFilter = null;
  let sourceFilter = null;
  let query = '';
  let order = store.prefs().hlOrder || 'item';

  const keys = Object.keys(store.state.highlights).filter((k) => store.highlightsFor(k).length);
  const qids = keys.filter((k) => !isLibraryKey(k) && meta(k));
  const libKeys = keys.filter((k) => isLibraryKey(k) && topicMeta(topicIdFromKey(k)));

  if (!qids.length && !libKeys.length) {
    fill(host, empty({
      mark: '▤', title: 'No highlights yet',
      text: 'Select any passage in a vignette or explanation to mark it. Everything you highlight collects here.',
      action: h('button.btn.btn--primary', { onclick: () => go('/browse') }, 'Open the question bank'),
    }));
    return { title: 'Highlights', el };
  }

  // Resolve the passages: load each source file once, then slice the stored
  // range out of the block's plain text.
  await Promise.all([
    ...new Set(qids.map((id) => meta(id).cat)),
  ].map((s) => loadCategory(s).catch(() => null)));
  await Promise.all([
    ...new Set(libKeys.map((k) => topicMeta(topicIdFromKey(k)).cat)),
  ].map((s) => loadChapter(s).catch(() => null)));

  /* Questions and library topics are different things that highlight the same
     way, so each resolves to one shape and the rest of the view never asks
     which it is looking at. */
  const groups = [];

  const collect = (key, blocks, label) => {
    const flow = Object.keys(blocks);
    return store.highlightsFor(key).map((hl) => ({
      hl,
      pos: flow.indexOf(hl.b),
      where: label(hl.b),
      text: (blocks[hl.b] || '').slice(hl.s, hl.e) || '(passage no longer present)',
    }));
  };

  for (const qid of qids) {
    let q;
    try { q = await getQuestion(qid); } catch { continue; }
    const m = meta(qid);
    groups.push({
      key: qid, kind: 'item', cat: m.cat,
      label: qid, title: m.topic,
      open: () => go(`/browse/${qid}?from=highlights`),
      openAt: (hl) => go(`/browse/${qid}?hl=${encodeURIComponent(hl.id)}&from=highlights`),
      clip: (it) => clipText({ qid, text: it.text, source: sourceLabel(it.hl.b) }),
      items: collect(qid, blockText(q), (b) => sourceLabel(b)),
    });
  }

  for (const key of libKeys) {
    const tid = topicIdFromKey(key);
    let doc;
    try { doc = await getTopic(tid); } catch { continue; }
    groups.push({
      key, kind: 'topic', cat: doc.cat,
      label: 'Library', title: doc.title,
      open: () => go(`/library/${tid}`),
      openAt: (hl) => go(`/library/${tid}?hl=${encodeURIComponent(hl.id)}`),
      clip: (it) => clipPassage({
        topicId: tid, title: doc.title, text: it.text, source: it.where,
      }),
      items: collect(key, topicBlocks(doc), (b) => blockSection(doc, b)?.heading || 'Topic'),
    });
  }

  const latest = (g) => g.items.reduce((m, it) => Math.max(m, it.hl.at || 0), 0);

  /* The count in the page header has to follow removals, or it keeps
     announcing passages that are no longer there. */
  function syncSubtitle() {
    const p = document.querySelector('.topbar__title p');
    if (p) p.textContent = subtitle();
  }

  function draw() {
    // A group survives a query that names its topic or id, so the reader can
    // search the way they think — "asthma" — not only by highlighted words.
    const q = query.trim().toLowerCase();
    const scoped = groups
      .map((g) => {
        const groupHit = q && `${g.title} ${g.label}`.toLowerCase().includes(q);
        return {
          ...g,
          items: g.items.filter((it) => !q || groupHit || it.text.toLowerCase().includes(q)),
        };
      })
      .filter((g) => g.items.length
        && (!catFilter || g.cat === catFilter)
        && (!sourceFilter || g.kind === sourceFilter));

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
      : (a, b) => a.key.localeCompare(b.key));

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
          [...new Set(groups.map((g) => g.cat))].map((slug) => h('option', {
            value: slug, selected: catFilter === slug,
          }, cat(slug)?.name || chapter(slug)?.name || slug))),
        // Only worth offering once both kinds are actually on the page.
        groups.some((g) => g.kind === 'topic') && groups.some((g) => g.kind === 'item')
          ? h('select.select', {
            style: { width: 'auto' },
            'aria-label': 'Source',
            onchange: (ev) => { sourceFilter = ev.target.value || null; draw(); },
          },
            h('option', { value: '' }, 'Questions and library'),
            h('option', { value: 'item', selected: sourceFilter === 'item' }, 'Questions only'),
            h('option', { value: 'topic', selected: sourceFilter === 'topic' }, 'Library only'))
          : null,
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
            g.kind === 'topic'
              ? h('span.badge.badge--blue', 'Library')
              : h('span.item-head__id', g.label),
            catTag(g.cat),
            h('span.xs.muted.truncate', g.title),
            h('div.panel__act',
              h('span.xs.muted.num', n(g.items.length)),
              h('button.btn.btn--sm', { onclick: g.open },
                g.kind === 'topic' ? 'Open topic' : 'Open item'))),
          h('div.panel__body.stack-8', g.items.map((it) => row(g, it))))))
        : empty({ title: 'Nothing matches', text: 'Loosen the filters or clear the search.' }));
  }

  function row(g, it) {
    const { hl } = it;
    const linked = hl.note ? store.noteById(hl.note) : null;
    return h('div.hl-row',
      h('span.hl-row__bar', { style: { background: `var(--hl-${hl.c})` } }),
      h('div.grow.hl-row__main',
        // The passage is the link: it opens the source scrolled to this exact
        // mark, which is the only reason to keep a list of them.
        h('button.hl-row__t', {
          title: g.kind === 'topic'
            ? 'Open this passage in the library'
            : 'Open this passage in the item',
          onclick: () => g.openAt(hl),
        }, it.text),
        h('div.hl-row__meta',
          it.where,
          hl.at ? ` · ${ago(hl.at)}` : null,
          linked ? ' · in your notebook' : null)),
      h('div.hl-row__act',
        linked
          ? h('button.btn.btn--sm', { onclick: () => go(`/notebook/${linked.id}`) }, 'Open note')
          : h('button.btn.btn--sm', {
            onclick: () => {
              g.clip(it);
              store.updateHighlight(g.key, hl.id, { note: activeNote().id });
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
    store.removeHighlight(g.key, hl.id);
    const live = groups.find((x) => x.key === g.key);
    if (live) live.items = live.items.filter((x) => x.hl.id !== hl.id);
    draw();
    syncSubtitle();
    toast('Highlight removed', {
      action: 'Undo',
      onAction: () => {
        const back = store.addHighlight(g.key, {
          block: hl.b, start: hl.s, end: hl.e, color: hl.c,
          id: hl.id, at: hl.at, note: hl.note,
        });
        live?.items.push({ ...it, hl: back });
        draw();
        syncSubtitle();
      },
    });
  }

  /* Named for what they are: an item and a topic are not the same kind of
     source, and calling them both "items" would be wrong once both exist. */
  function subtitle() {
    const total = groups.reduce((s, g) => s + g.items.length, 0);
    const live = groups.filter((g) => g.items.length);
    const items = live.filter((g) => g.kind === 'item').length;
    const topics = live.filter((g) => g.kind === 'topic').length;
    const where = [
      items ? `${n(items)} item${items === 1 ? '' : 's'}` : null,
      topics ? `${n(topics)} topic${topics === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' and ');
    return `${n(total)} passages across ${where || 'nothing'}`;
  }

  draw();

  return {
    title: 'Highlights',
    subtitle: subtitle(),
    actions: [
      h('button.btn.btn--sm.btn--danger', {
        onclick: async () => {
          const ok = await confirm({
            title: 'Clear every highlight?',
            desc: 'Passages already saved to your notebook are kept.',
            ok: 'Clear highlights', danger: true,
          });
          if (!ok) return;
          for (const g of groups) for (const it of g.items) store.removeHighlight(g.key, it.hl.id);
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
