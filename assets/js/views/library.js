/* The library: chapters of topics, and a topic read at full size.

   The viewer is the same document the reading sheet shows, given the room to
   be read properly: contents on the left, the text in the middle at a
   comfortable measure, and the topic's own sections on the right. Opening a
   question from here opens it over the text rather than navigating away, which
   is the mirror of opening a topic from a question. */

import { h, fill, $ } from '../core/dom.js';
import * as store from '../core/store.js';
import { go } from '../core/router.js';
import { n } from '../core/fmt.js';
import {
  library, loadChapter, getTopic, topicMeta, chapter, searchTopics, highlightKey,
} from '../core/library.js';
import { topicDocument, outline, topicQuestionCount } from '../render/topic.js';
import { attachHighlighter, hidePopover } from '../features/highlight.js';
import { clipPassage } from '../features/capture.js';
import { openItem } from '../features/sheet.js';
import { empty, sampleNotice } from './parts.js';

export default async function libraryView({ topicId, query = {} }) {
  return topicId ? reader(topicId, query) : contents(query);
}

/* ══ the contents ══════════════════════════════════════════════════════ */

async function contents(query) {
  let search = query.q || '';

  const el = h('div.wrap');
  const host = h('div');
  el.appendChild(host);

  const collapsed = () => new Set(store.prefs().collapsedChapters || []);
  const toggle = (slug) => {
    const set = collapsed();
    if (set.has(slug)) set.delete(slug); else set.add(slug);
    store.setPref('collapsedChapters', [...set]);
    draw();
  };

  function draw() {
    const q = search.trim();
    const hits = q ? searchTopics(q) : null;
    const shut = collapsed();

    fill(host,
      h('div.shelf__bar',
        h('div.search', { style: { width: '280px' } },
          h('input.input', {
            type: 'search', placeholder: 'Search the library…', value: search,
            oninput: (ev) => { search = ev.target.value; draw(); },
          })),
        h('div.push.xs.muted',
          `${n(library.index.meta.topics)} topics · ${n(library.index.meta.chapters)} chapters`)),

      hits
        ? (hits.length
          ? h('div.lib-hits', hits.map((t) => h('button.lib-hit', {
            onclick: () => go(`/library/${t.id}`),
          },
            h('span.dot', { style: { background: chapter(t.cat)?.dot } }),
            h('span.lib-hit__t', t.title),
            h('span.lib-hit__c', chapter(t.cat)?.name || t.cat),
            h('span.lib-hit__s.truncate', t.summary))))
          : empty({ mark: '⌕', title: 'No matching topics', text: 'Try a different search.' }))

        : h('div.shelf.shelf--page', library.index.chapters.map((ch) => {
          const isShut = shut.has(ch.slug);
          return h('section.shelf__book',
            h('div.shelf__head',
              h('button.shelf__toggle', {
                'aria-expanded': String(!isShut),
                onclick: () => toggle(ch.slug),
              },
                h('span.shelf__chev'),
                h('span.dot', { style: { background: ch.dot } }),
                h('span.shelf__name.truncate', ch.name),
                h('span.shelf__count', ch.count))),
            isShut ? null : h('div.lib-topics',
              ch.topics.map((t) => h('button.lib-topic', {
                onclick: () => go(`/library/${t.id}`),
              },
                h('span.lib-topic__t', t.title),
                h('span.lib-topic__s.truncate', t.summary)))));
        })),

      q ? null : h('div', { style: { marginTop: '20px' } }, sampleNotice()));
  }

  draw();

  return {
    title: 'Library',
    subtitle: `${n(library.index.meta.topics)} topics · ${n(library.index.meta.words)} words`,
    el,
  };
}

/* ══ one topic, read at full size ══════════════════════════════════════ */

async function reader(topicId, query) {
  const entry = topicMeta(topicId);
  if (!entry) {
    return {
      title: 'Topic not found',
      el: h('div.wrap', empty({
        mark: '?', title: `No topic with id ${topicId}`,
        action: h('a.btn.btn--primary', { href: '#/library' }, 'Back to the library'),
      })),
    };
  }

  await loadChapter(entry.cat);
  const doc = await getTopic(topicId);
  const ch = chapter(doc.cat);
  const qCount = topicQuestionCount(doc);
  let detach = null;

  const docHost = h('div.lib-doc.scroll');
  const tocHost = h('nav.lib-toc', { 'aria-label': 'On this page' });
  const navHost = h('nav.lib-nav.scroll', { 'aria-label': 'Contents' });

  // The wrapper is what the layout measures itself against, so the panes fold
  // away when the notebook takes the room — not when the window happens to be
  // narrow.
  const el = h('div.lib-wrap', h('div.lib', navHost, docHost, tocHost));

  /* Chapter contents on the left: the topic being read sits inside its own
     chapter, so moving to the next one never means going back first. */
  function drawNav() {
    fill(navHost,
      h('a.lib-nav__back', { href: '#/library' }, '‹ All chapters'),
      h('p.lib-nav__ch',
        h('span.dot', { style: { background: ch?.dot } }),
        ch?.name || doc.cat),
      h('ul', (ch?.topics || []).map((t) => h('li',
        h('button.lib-nav__t', {
          'aria-current': String(t.id === topicId),
          onclick: () => go(`/library/${t.id}`),
        }, t.title)))));
  }

  function paint() {
    const art = topicDocument(doc, {
      showQuestions: store.prefs().libQuestions === true,
      // From the library a question opens over the text, not instead of it.
      onQuestion: (qid) => openItem(qid),
    });

    fill(docHost, h('div.lib-doc__inner',
      h('header.lib-doc__head',
        h('p.lib-doc__ch',
          h('span.dot', { style: { background: ch?.dot } }),
          ch?.name || doc.cat),
        h('h1', doc.title)),
      art,
      doc.related?.length
        ? h('div.topic__related',
          h('p.label', 'Related topics'),
          h('div.row.row--wrap', { style: { gap: '6px' } },
            doc.related.map((rid) => {
              const m = topicMeta(rid);
              return m ? h('button.chip', { onclick: () => go(`/library/${rid}`) }, m.title) : null;
            })))
        : null,
      sampleNotice()));

    detach?.();
    detach = attachHighlighter(art, {
      qid: highlightKey(doc.id),
      clip: ({ text, label }) => clipPassage({
        topicId: doc.id, title: doc.title, text, source: label,
      }),
    });
    drawToc();
    if (query.hl) revealHighlight(docHost, query.hl);
  }

  function drawToc() {
    fill(tocHost,
      h('p.label', 'On this page'),
      h('ul', outline(doc).map((s) => h('li',
        h('button.lib-toc__l', {
          dataset: { sec: s.id },
          onclick: () => docHost.querySelector(`#sec-${CSS.escape(s.id)}`)
            ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
        }, s.heading)))),
      h('label.sheet__toggle', {
        title: 'Show the bank’s questions beside the passage each one examines',
      },
        h('input', {
          type: 'checkbox',
          checked: store.prefs().libQuestions === true,
          onchange: (ev) => { store.setPref('libQuestions', ev.target.checked); paint(); },
        }),
        h('span', 'Questions'),
        qCount ? h('span.sheet__toggle-n', qCount) : null));
  }

  /* Mark the section being read, so the contents list answers "where am I"
     without the reader having to work it out from the headings. */
  let spy = null;
  function watchSections() {
    const heads = [...docHost.querySelectorAll('.topic__h')];
    spy = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = e.target.id.replace(/^sec-/, '');
        tocHost.querySelectorAll('.lib-toc__l').forEach((b) => {
          b.setAttribute('aria-current', String(b.dataset.sec === id));
        });
      }
    }, { root: docHost, rootMargin: '0px 0px -70% 0px', threshold: 0 });
    heads.forEach((x) => spy.observe(x));
  }

  drawNav();
  paint();

  return {
    title: doc.title,
    subtitle: `${ch?.name || doc.cat} · ${doc.sections.length} sections`,
    actions: [
      h('a.btn.btn--sm', { href: '#/library' }, '← Library'),
    ],
    el,
    fixed: true,
    mounted() { watchSections(); },
    destroy() { detach?.(); spy?.disconnect(); hidePopover(); },
  };
}

/** Put a highlight on screen and mark it briefly, as the reader does. */
function revealHighlight(root, hlId) {
  requestAnimationFrame(() => {
    const mark = root.querySelector(`mark.hl[data-id="${CSS.escape(hlId)}"]`);
    if (!mark) return;
    mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
    mark.classList.add('hl--found');
    setTimeout(() => mark.classList.remove('hl--found'), 2200);
  });
}
