/* The notebook.

   Three panes: notebooks, the note list, and the editor. Clips carry their
   origin with them — a passage keeps its highlight colour and a link back to
   the question, and a figure keeps its spec so it redraws with the theme. */

import { h, fill } from '../core/dom.js';
import * as store from '../core/store.js';
import { meta, cat } from '../core/bank.js';
import { go } from '../core/router.js';
import { ago, n, stamp } from '../core/fmt.js';
import { markdown, htmlToText, htmlToMarkdown, excerpt } from '../render/prose.js';
import { figureSvg } from '../render/figure.js';
import { tableBlock } from '../render/table.js';
import { toast, confirm, prompt, modal } from '../features/overlay.js';
import { chooseTarget } from '../features/capture.js';
import { enableBlockDrag } from '../features/blockdrag.js';
import { empty } from './parts.js';

export default async function notebook({ noteId }) {
  store.ensureNotebook();

  let bookFilter = 'all';
  let search = '';
  let current = noteId ? store.noteById(noteId) : store.state.notes[0] || null;

  const railHost = h('aside.nb__rail');
  const listHost = h('div.nb__list');
  const editHost = h('div.nb__editor');
  const el = h('div.nb', railHost, listHost, editHost);

  /* ── notebooks rail ─────────────────────────────────────────────────── */

  function drawRail() {
    const counts = {};
    for (const nt of store.state.notes) counts[nt.book] = (counts[nt.book] || 0) + 1;

    const tags = new Map();
    for (const nt of store.state.notes) for (const t of nt.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
    const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const pinnedId = store.captureTarget()?.id || null;

    fill(railHost,
      h('div.filter-group',
        h('span.label', 'Notebooks'),
        h('div.filter-list',
          h('button.filter-row', {
            'aria-pressed': String(bookFilter === 'all'),
            onclick: () => { bookFilter = 'all'; draw(); },
          }, h('span.truncate.grow', 'All notes'), h('small', n(store.state.notes.length))),

          store.state.notebooks.map((b) => h('div.book-row',
            h('button.filter-row.grow', {
              'aria-pressed': String(bookFilter === b.id),
              onclick: () => { bookFilter = b.id; draw(); },
            },
              h('span.dot', { style: { background: b.color } }),
              h('span.truncate.grow', b.name),
              h('small', n(counts[b.id] || 0))),
            h('button.book-row__menu', {
              title: `Manage ${b.name}`, 'aria-label': `Manage ${b.name}`,
              onclick: () => manageNotebook(b),
            }, '···'))),

          h('button.filter-row.filter-row--add', {
            onclick: async () => {
              const name = await prompt({
                title: 'New notebook', label: 'Name',
                placeholder: 'e.g. Cardiology revision', ok: 'Create',
              });
              if (!name) return;
              const book = store.createNotebook(name);
              bookFilter = book.id;
              draw();
            },
          }, h('span', '+'), h('span.grow', 'New notebook'))),
      ),

      topTags.length
        ? h('div.filter-group',
          h('span.label', 'Tags'),
          h('div.row.row--wrap', { style: { gap: '5px' } },
            topTags.map(([t, c]) => h('button.chip', {
              'aria-pressed': String(search === t),
              onclick: () => { search = search === t ? '' : t; draw(); },
            }, t, h('span.chip__n', c)))))
        : null,

      h('div.filter-group',
        h('span.label', 'Clippings go to'),
        h('button.dest__pick', {
          onclick: () => chooseTarget({ onPick: () => draw() }),
        },
          h('span.dot', { style: { background: pinnedId ? (store.notebookById(store.captureTarget().book)?.color || 'var(--blue)') : 'var(--ink-4)' } }),
          h('span.dest__t.grow.truncate',
            h('b', pinnedId ? (store.captureTarget().title || 'Untitled note') : 'Per-question notes'),
            h('small', pinnedId ? 'pinned destination' : 'a note for each question')),
          h('span.dest__chev', '▾'))),

      h('div.filter-group',
        h('button.btn.btn--sm.btn--block', { onclick: exportAll }, 'Export all as Markdown')),
    );
  }

  async function manageNotebook(book) {
    const swatches = h('div.row.row--wrap', { style: { gap: '6px' } },
      store.BOOK_COLORS.map((c) => h('button.sw', {
        'aria-pressed': String(book.color === c),
        style: { background: c },
        title: 'Set colour', 'aria-label': `Set colour ${c}`,
        onclick: (ev) => {
          store.updateNotebook(book.id, { color: c });
          ev.currentTarget.parentElement.querySelectorAll('.sw')
            .forEach((s) => s.setAttribute('aria-pressed', 'false'));
          ev.currentTarget.setAttribute('aria-pressed', 'true');
          draw();
        },
      })));

    const nameField = h('input.input', { type: 'text', value: book.name });
    const noteCount = store.state.notes.filter((x) => x.book === book.id).length;
    const canDelete = store.state.notebooks.length > 1;

    modal({
      title: 'Notebook',
      desc: `${noteCount} note${noteCount === 1 ? '' : 's'}`,
      body: h('div.stack-16',
        h('label.field', h('span.label', 'Name'), nameField),
        h('div.field', h('span.label', 'Colour'), swatches)),
      actions: (close) => [
        canDelete
          ? h('button.btn.btn--danger', {
            onclick: async () => {
              close();
              const ok = await confirm({
                title: `Delete “${book.name}”?`,
                desc: noteCount
                  ? `Its ${noteCount} note${noteCount === 1 ? '' : 's'} will move to ${store.state.notebooks.find((x) => x.id !== book.id).name}.`
                  : 'This notebook is empty.',
                ok: 'Delete notebook', danger: true,
              });
              if (!ok) return;
              store.deleteNotebook(book.id);
              if (bookFilter === book.id) bookFilter = 'all';
              draw();
              toast('Notebook deleted');
            },
          }, 'Delete')
          : null,
        h('button.btn.btn--primary', {
          onclick: () => {
            const name = nameField.value.trim();
            if (name) store.renameNotebook(book.id, name);
            close();
            draw();
          },
        }, 'Done'),
      ].filter(Boolean),
    });
  }

  /* ── note list ──────────────────────────────────────────────────────── */

  function visibleNotes() {
    const s = search.trim().toLowerCase();
    return store.state.notes.filter((nt) => {
      if (bookFilter !== 'all' && nt.book !== bookFilter) return false;
      if (!s) return true;
      const hay = `${nt.title} ${htmlToText(nt.html) || nt.body} ${(nt.tags || []).join(' ')} ${nt.clips.map((c) => c.text || c.source || '').join(' ')}`;
      return hay.toLowerCase().includes(s);
    });
  }

  function drawList() {
    const notes = visibleNotes();
    fill(listHost,
      h('div.nb__list-head',
        h('div.row',
          h('button.btn.btn--primary.btn--sm.grow', {
            onclick: () => {
              const nt = store.createNote({ book: bookFilter === 'all' ? undefined : bookFilter });
              current = nt;
              draw();
              editHost.querySelector('.nb-title')?.focus();
            },
          }, 'New note')),
        h('div.search',
          h('input.input', {
            type: 'search', placeholder: 'Search notes…', value: search,
            oninput: (ev) => { search = ev.target.value; drawList(); },
          }))),
      h('div.nb__items',
        notes.length
          ? notes.map((nt) => h('button.nb-item', {
            'aria-current': String(current?.id === nt.id),
            onclick: () => { current = nt; go(`/notebook/${nt.id}`); },
          },
            h('div.nb-item__t',
              store.captureTarget()?.id === nt.id
                ? h('span', { title: 'Clippings are collecting here', style: { color: 'var(--blue)' } }, '★ ')
                : null,
              nt.title || 'Untitled note'),
            h('div.nb-item__p', preview(nt)),
            h('div.nb-item__m',
              h('span.dot', { style: { background: store.notebookById(nt.book)?.color || 'var(--ink-4)', width: '6px', height: '6px' } }),
              h('span', ago(nt.updated)),
              nt.clips.length ? h('span', '·') : null,
              nt.clips.length ? h('span', `${nt.clips.length} clip${nt.clips.length === 1 ? '' : 's'}`) : null,
              nt.qid ? h('span', '·') : null,
              nt.qid ? h('span.mono', nt.qid) : null)))
          : empty({
            title: search ? 'No matching notes' : 'No notes yet',
            text: search ? 'Try a different search.' : 'Highlight a passage in any question, or start a note here.',
          })));
  }

  /* ── editor ─────────────────────────────────────────────────────────── */

  let saveTimer = null;
  let detachDrag = null;
  const queueSave = (patch) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!current) return;
      store.updateNote(current.id, patch());
      drawList();
    }, 400);
  };

  function drawEditor() {
    if (!current) {
      fill(editHost, h('div.nb-edit-body', empty({
        mark: '✎', title: 'Nothing selected',
        text: 'Choose a note from the list, or create one.',
      })));
      return;
    }
    const nt = current;
    migrate(nt);
    const book = store.notebookById(nt.book);

    const titleEl = h('input.nb-title', {
      type: 'text', value: nt.title, placeholder: 'Untitled note',
      oninput: () => queueSave(() => ({ title: titleEl.value })),
      onkeydown: (ev) => {
        // Enter in the title drops into the document, as it should.
        if (ev.key === 'Enter') { ev.preventDefault(); focusEnd(); }
      },
    });

    const doc = h('div.doc', {
      contenteditable: 'true',
      spellcheck: 'true',
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': 'Note',
      html: nt.html || '<p><br></p>',
      oninput: () => { markEmpty(doc); queueSave(() => ({ html: serialise(doc) })); },
      onkeydown: onDocKey,
      onpaste: (ev) => {
        // Keep the document to the shapes the editor understands.
        ev.preventDefault();
        const text = ev.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
      },
    });

    fill(editHost,
      h('div.nb-edit-head',
        h('div.push.row', { style: { gap: '6px', marginLeft: 0 } },
          h('select.select', {
            style: { width: 'auto' },
            onchange: (ev) => { store.updateNote(nt.id, { book: ev.target.value }); draw(); },
          }, store.state.notebooks.map((b) => h('option', { value: b.id, selected: b.id === nt.book }, b.name))),
          h('button.btn.btn--sm', {
            'aria-pressed': String(store.captureTarget()?.id === nt.id),
            style: store.captureTarget()?.id === nt.id
              ? { color: 'var(--blue)', borderColor: 'var(--blue-2)' } : null,
            title: 'Send clippings from questions to this note',
            onclick: () => {
              const on = store.captureTarget()?.id === nt.id;
              store.setCaptureTarget(on ? null : nt.id);
              toast(on ? 'Clippings go to a note per question'
                : `Clippings now go to “${nt.title || 'Untitled note'}”`);
              draw();
            },
          }, store.captureTarget()?.id === nt.id ? '★ Collecting' : '☆ Collect here'),
          nt.qid ? h('button.btn.btn--sm', { onclick: () => go(`/browse/${nt.qid}`) }, 'Open item') : null,
          h('button.btn.btn--sm', { onclick: () => exportNote(nt) }, 'Export'),
          h('button.btn.btn--sm.btn--danger', {
            onclick: async () => {
              const ok = await confirm({
                title: 'Delete this note?', desc: 'This cannot be undone.',
                ok: 'Delete', danger: true,
              });
              if (!ok) return;
              store.deleteNote(nt.id);
              current = store.state.notes[0] || null;
              go(current ? `/notebook/${current.id}` : '/notebook');
            },
          }, 'Delete'))),

      h('div.nb-edit-body', {
        // Clicking the empty space under the last block puts the caret at the
        // end, the way a page of paper behaves.
        onmousedown: (ev) => {
          if (ev.target === ev.currentTarget || ev.target.classList.contains('nb-edit-inner')) {
            ev.preventDefault(); focusEnd();
          }
        },
      },
        h('div.nb-edit-inner',
          titleEl,
          tagRow(nt),
          docToolbar(doc),
          h('div.doc-wrap', doc),
          h('p.xs.muted', { style: { marginTop: '24px' } },
            `${book ? book.name : 'General'} · created ${ago(nt.created)} · updated ${ago(nt.updated)}`))));

    hydrate(doc, nt);
    markEmpty(doc);

    detachDrag?.();
    detachDrag = enableBlockDrag(editHost.querySelector('.doc-wrap'), doc, () => {
      clearTimeout(saveTimer);
      store.updateNote(nt.id, { html: serialise(doc) });
      markEmpty(doc);
    });
    // Ask the browser for <p> rather than <div> when a new block is made.
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* not supported */ }
  }

  /** Flags a blank document so its placeholder shows. */
  function markEmpty(doc) {
    const blank = !doc.querySelector('.doc-clip') && !doc.textContent.trim();
    doc.dataset.empty = blank ? '1' : '';
  }

  /* ── document plumbing ──────────────────────────────────────────────── */

  const attr = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  /**
   * Bring older notes into the document editor: markdown bodies become
   * content, and prose clippings become editable quotations rather than the
   * locked cards they used to be. Runs once per note.
   */
  function migrate(nt) {
    const proseClips = nt.clips.filter((c) => c.kind === 'text' || c.kind === 'question');
    if (nt.html && !proseClips.length) return;
    if (!nt.html && !nt.body && !nt.clips.length) return;

    let html = nt.html || (nt.body ? markdown(nt.body) : '');

    // Replace any locked prose block already placed in the document.
    if (nt.html && proseClips.length) {
      const box = document.createElement('div');
      box.innerHTML = html;
      for (const c of proseClips) {
        const el = box.querySelector(`.doc-clip[data-clip="${CSS.escape(c.id)}"]`);
        if (el) el.replaceWith(quoteEl(c));
      }
      html = box.innerHTML;
    } else {
      for (const c of nt.clips) {
        if (c.kind === 'text' || c.kind === 'question') html += quoteEl(c).outerHTML + '<p><br></p>';
        else {
          html += `<div class="doc-clip" contenteditable="false" data-clip="${c.id}"`
            + ` data-kind="${c.kind}" data-summary="${attr(store.clipSummary(c))}"></div><p><br></p>`;
        }
      }
    }

    store.updateNote(nt.id, {
      html: html || '<p><br></p>',
      clips: nt.clips.filter((c) => c.kind !== 'text' && c.kind !== 'question'),
    });
  }

  function quoteEl(c) {
    const m = c.qid ? meta(c.qid) : null;
    const src = [c.source, m ? m.topic : null, c.qid].filter(Boolean).join(' · ');
    const q = h('blockquote.doc-quote', { dataset: { src, hl: c.color || null } },
      h('p', c.text || (m ? m.ask : '')));
    return q;
  }

  /** Strip drawn clip contents before storing, so only the reference persists. */
  function serialise(doc) {
    const copy = doc.cloneNode(true);
    copy.querySelectorAll('.doc-clip').forEach((el) => {
      el.replaceChildren();
      el.removeAttribute('style');
    });
    // The editor can nest a list inside a paragraph, which is invalid and only
    // survives because re-parsing hoists it. Normalise before storing so what
    // is written to disk is the same shape that comes back.
    const norm = document.createElement('div');
    norm.innerHTML = copy.innerHTML;
    norm.querySelectorAll('p:empty').forEach((p, i, all) => {
      if (i < all.length - 1) p.remove();          // keep one place to type
    });
    return norm.innerHTML;
  }

  /** Draw every clip block that is currently in the document. */
  function hydrate(doc, nt) {
    for (const el of doc.querySelectorAll('.doc-clip')) {
      const c = nt.clips.find((x) => x.id === el.dataset.clip);
      if (!c) { el.remove(); continue; }
      el.setAttribute('contenteditable', 'false');
      // Keep the summary current so list previews and search read the clipping.
      el.dataset.summary = store.clipSummary(c);
      fill(el, clipBlock(nt, c));
    }
    // A clipping at either end would leave nowhere to put the caret, so the
    // document always opens and closes with a line you can type on.
    if (doc.firstElementChild?.classList.contains('doc-clip')) {
      doc.insertBefore(h('p', h('br')), doc.firstElementChild);
    }
    if (!doc.lastElementChild || doc.lastElementChild.classList.contains('doc-clip')) {
      doc.appendChild(h('p', h('br')));
    }
  }

  function focusEnd() {
    const doc = editHost.querySelector('.doc');
    if (!doc) return;
    if (!doc.lastElementChild || doc.lastElementChild.classList.contains('doc-clip')) {
      doc.appendChild(h('p', h('br')));
    }
    const range = document.createRange();
    range.selectNodeContents(doc.lastElementChild);
    range.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    doc.focus();
  }

  function onDocKey(ev) {
    const doc = ev.currentTarget;
    if (ev.metaKey || ev.ctrlKey) {
      const k = ev.key.toLowerCase();
      const cmd = { b: 'bold', i: 'italic', u: 'underline' }[k];
      if (cmd) { ev.preventDefault(); document.execCommand(cmd); queueSave(() => ({ html: serialise(doc) })); }
      return;
    }
    // Never let a caret land inside a drawn clip.
    if (ev.key === 'Backspace') {
      const sel = getSelection();
      if (sel.isCollapsed && sel.anchorOffset === 0) {
        const block = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
        const prev = block?.closest('.doc > *')?.previousElementSibling;
        if (prev?.classList.contains('doc-clip')) {
          ev.preventDefault();
          const id = prev.dataset.clip;
          prev.remove();
          store.removeClip(current.id, id);
          queueSave(() => ({ html: serialise(doc) }));
        }
      }
    }
  }

  function exec(doc, cmd, arg) {
    doc.focus();
    document.execCommand(cmd, false, arg);
    queueSave(() => ({ html: serialise(doc) }));
  }

  function docToolbar(doc) {
    const b = (label, title, fn, cls = '') => h(`button.nb-tool${cls}`, {
      type: 'button', title,
      onmousedown: (ev) => ev.preventDefault(),   // keep the selection
      onclick: fn,
    }, label);
    const sep = () => h('div', { style: { width: '1px', height: '16px', background: 'var(--rule)', margin: '0 4px' } });
    return h('div.nb-toolbar',
      b('B', 'Bold  ⌘B', () => exec(doc, 'bold')),
      b('I', 'Italic  ⌘I', () => exec(doc, 'italic'), '.nb-tool--i'),
      sep(),
      b('H', 'Heading', () => exec(doc, 'formatBlock', 'h2')),
      b('h', 'Subheading', () => exec(doc, 'formatBlock', 'h3')),
      b('¶', 'Body text', () => exec(doc, 'formatBlock', 'p')),
      sep(),
      b('•', 'Bullet list', () => exec(doc, 'insertUnorderedList')),
      b('1.', 'Numbered list', () => exec(doc, 'insertOrderedList')),
      b('❝', 'Quote', () => exec(doc, 'formatBlock', 'blockquote')),
      sep(),
      b('─', 'Divider', () => exec(doc, 'insertHorizontalRule')));
  }

  /** The drawn contents of a clipping, sitting inline in the document. */
  function clipBlock(nt, c) {
    const m = c.qid ? meta(c.qid) : null;
    const origin = m ? `${m.topic} · ${cat(m.cat)?.name} · ${c.qid}` : (c.qid || '');

    const tools = h('div.doc-clip__tools', { contenteditable: 'false' },
      c.qid ? h('button.btn.btn--sm', { onclick: () => go(`/browse/${c.qid}`) }, 'Open item') : null,
      h('button.btn.btn--sm.btn--ghost', {
        title: 'Remove this clipping',
        onclick: () => { store.removeClip(nt.id, c.id); drawEditor(); },
      }, '✕'));

    let inner;
    if (c.kind === 'text') {
      inner = h('blockquote.doc-quote', { style: { '--hlc': `var(--hl-${c.color || 'yellow'})` } },
        h('p', c.text),
        h('cite', [c.source, origin].filter(Boolean).join(' · ')));
    } else if (c.kind === 'figure') {
      inner = h('figure.doc-figure',
        figureSvg(c.spec),
        h('figcaption', h('b', c.spec.title), c.spec.caption ? ` — ${c.spec.caption}` : ''));
    } else if (c.kind === 'table') {
      inner = tableBlock(c.spec);
    } else {
      inner = h('div.doc-qref',
        h('b', m ? m.topic : c.qid),
        m ? h('p', m.ask) : null,
        h('cite', origin));
    }
    return [tools, inner];
  }

  function tagRow(nt, readOnly = false) {
    return h('div.row.row--wrap', { style: { gap: '5px' } },
      (nt.tags || []).map((t) => h('span.badge',
        t,
        !readOnly && h('button', {
          style: { marginLeft: '3px', opacity: .6 }, title: `Remove ${t}`,
          onclick: () => {
            store.updateNote(nt.id, { tags: nt.tags.filter((x) => x !== t) });
            drawEditor();
          },
        }, '✕'))),
      !readOnly && h('button.btn.btn--sm.btn--ghost', {
        onclick: async () => {
          const t = await prompt({ title: 'Add a tag', label: 'Tag', placeholder: 'e.g. high-yield' });
          if (!t) return;
          store.updateNote(nt.id, { tags: [...new Set([...(nt.tags || []), t])] });
          draw();
        },
      }, '+ Tag'));
  }

  function toolbar(bodyEl) {
    const wrapSel = (before, after = before) => {
      const { selectionStart: s, selectionEnd: e, value } = bodyEl;
      bodyEl.value = value.slice(0, s) + before + value.slice(s, e) + after + value.slice(e);
      bodyEl.focus();
      bodyEl.setSelectionRange(s + before.length, e + before.length);
      queueSave(() => ({ body: bodyEl.value }));
    };
    const linePrefix = (prefix) => {
      const { selectionStart: s, value } = bodyEl;
      const start = value.lastIndexOf('\n', s - 1) + 1;
      bodyEl.value = value.slice(0, start) + prefix + value.slice(start);
      bodyEl.focus();
      queueSave(() => ({ body: bodyEl.value }));
    };
    return h('div.nb-toolbar',
      h('button.nb-tool', { title: 'Bold (⌘B)', onclick: () => wrapSel('**') }, 'B'),
      h('button.nb-tool.nb-tool--i', { title: 'Italic (⌘I)', onclick: () => wrapSel('*') }, 'I'),
      h('button.nb-tool', { title: 'Inline code', onclick: () => wrapSel('`') }, '‹›'),
      h('div', { style: { width: '1px', height: '16px', background: 'var(--rule)', margin: '0 4px' } }),
      h('button.nb-tool', { title: 'Heading', onclick: () => linePrefix('## ') }, 'H'),
      h('button.nb-tool', { title: 'Bullet list', onclick: () => linePrefix('- ') }, '•'),
      h('button.nb-tool', { title: 'Numbered list', onclick: () => linePrefix('1. ') }, '1.'),
      h('button.nb-tool', { title: 'Quote', onclick: () => linePrefix('> ') }, '❝'));
  }

  function clipCard(nt, c) {
    const m = c.qid ? meta(c.qid) : null;
    const head = h('div.clip__head',
      h('span', c.kind === 'text' ? 'Passage' : c.kind === 'figure' ? 'Figure'
        : c.kind === 'table' ? 'Table' : 'Question'),
      c.source ? h('span.truncate', { style: { fontWeight: 400 } }, `· ${c.source}`) : null,
      h('div.push',
        c.qid ? h('button.btn.btn--sm.btn--ghost', { onclick: () => go(`/browse/${c.qid}`) }, 'Open item') : null,
        h('button.btn.btn--sm.btn--ghost', {
          title: 'Remove this clipping',
          onclick: () => { store.removeClip(nt.id, c.id); drawEditor(); },
        }, '✕')));

    let body;
    if (c.kind === 'text') {
      body = h('div.clip__body',
        h('div.clip__quote', { style: { '--hlc': `var(--hl-${c.color || 'yellow'})` } }, c.text),
        m ? h('div.clip__src', `${m.topic} · ${cat(m.cat)?.name} · ${c.qid}`) : null);
    } else if (c.kind === 'figure') {
      body = h('div.clip__body',
        h('div.fig__canvas', { style: { padding: 0 } }, figureSvg(c.spec)),
        h('div.clip__src', c.spec.caption));
    } else if (c.kind === 'table') {
      body = h('div.clip__body', { style: { padding: 0 } }, tableBlock(c.spec));
    } else {
      body = h('div.clip__body',
        m ? h('div.stack-4',
          h('b', m.topic),
          h('p.sm.muted', m.ask),
          h('p.xs.muted', `${cat(m.cat)?.name} · ${m.archetypeLabel} · ${m.pct}% answered correctly`))
          : h('p.sm.muted', `Item ${c.qid}`));
    }
    return h('div.clip', head, body);
  }

  /** One-line summary of a note for the list. */
  function preview(nt) {
    // A note not yet opened still holds markdown; strip its syntax for the list.
    const text = htmlToText(nt.html) || excerpt(nt.body) || '';
    if (text) return text.length > 140 ? `${text.slice(0, 140)}…` : text;
    return nt.clips.length
      ? `${nt.clips.length} clipping${nt.clips.length === 1 ? '' : 's'}` : 'Empty';
  }

  /* ── export ─────────────────────────────────────────────────────────── */

  function noteToMarkdown(nt) {
    const book = store.notebookById(nt.book);
    const out = [`# ${nt.title || 'Untitled note'}`, ''];
    if (nt.tags?.length) out.push(`*Tags: ${nt.tags.join(', ')}*`, '');
    out.push(`*${book?.name || 'General'} · updated ${new Date(nt.updated).toLocaleString()}*`, '');

    const clipMd = (id) => {
      const c = nt.clips.find((x) => x.id === id);
      if (!c) return '';
      const m = c.qid ? meta(c.qid) : null;
      const origin = m ? `${m.topic} — ${c.qid}` : (c.qid || '');
      if (c.kind === 'text') return `> ${c.text}\n>\n> — ${c.source || 'Passage'}, ${origin}`;
      if (c.kind === 'figure') return `**Figure — ${c.spec.title}**\n\n${c.spec.caption}\n\n— ${origin}`;
      if (c.kind === 'table') {
        const rows = [`**Table — ${c.spec.title}**`, '',
          `| ${c.spec.columns.join(' | ')} |`,
          `| ${c.spec.columns.map(() => '---').join(' | ')} |`];
        for (const r of c.spec.rows) rows.push(`| ${r.join(' | ')} |`);
        rows.push('', `— ${origin}`);
        return rows.join('\n');
      }
      return `**Question — ${origin}**\n\n${m ? m.ask : ''}`;
    };

    out.push(nt.html ? htmlToMarkdown(nt.html, clipMd) : (nt.body || ''));
    return out.join('\n');
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportNote(nt) {
    download(`${(nt.title || 'note').replace(/[^\w-]+/g, '-').toLowerCase()}.md`, noteToMarkdown(nt));
    toast('Note exported');
  }

  function exportAll() {
    const notes = visibleNotes();
    if (!notes.length) { toast('Nothing to export'); return; }
    const text = [`# Meridian notebook`, '', `*${notes.length} notes · exported ${new Date().toLocaleString()}*`, '', '---', '']
      .concat(notes.map(noteToMarkdown)).join('\n\n');
    download(`meridian-notebook-${stamp()}.md`, text);
    toast(`${notes.length} notes exported`);
  }

  /* ── wiring ─────────────────────────────────────────────────────────── */

  function draw() { drawRail(); drawList(); drawEditor(); }
  draw();

  const onKey = (ev) => {
    if (!(ev.metaKey || ev.ctrlKey)) return;
    const ta = editHost.querySelector('.nb-body');
    if (document.activeElement !== ta) return;
    const k = ev.key.toLowerCase();
    if (k === 'b' || k === 'i') {
      ev.preventDefault();
      const mark = k === 'b' ? '**' : '*';
      const { selectionStart: s, selectionEnd: e, value } = ta;
      ta.value = value.slice(0, s) + mark + value.slice(s, e) + mark + value.slice(e);
      ta.setSelectionRange(s + mark.length, e + mark.length);
      queueSave(() => ({ body: ta.value }));
    }
  };
  document.addEventListener('keydown', onKey);

  return {
    title: 'Notebook',
    subtitle: `${n(store.state.notes.length)} notes · ${n(store.state.notes.reduce((a, x) => a + x.clips.length, 0))} clippings`,
    el,
    fixed: true,
    destroy() {
      clearTimeout(saveTimer);
      detachDrag?.();
      if (current) {
        const t = editHost.querySelector('.nb-title');
        const b = editHost.querySelector('.nb-body');
        if (t || b) {
          store.updateNote(current.id, {
            ...(t ? { title: t.value } : {}),
            ...(b ? { body: b.value } : {}),
          });
        }
      }
      document.removeEventListener('keydown', onKey);
    },
  };
}
