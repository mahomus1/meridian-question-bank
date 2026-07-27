/* Text highlighting.

   A selection inside one block resolves to a character range against that
   block's plain text. Ranges persist per question, so a highlight comes back on
   reload without depending on the DOM shape that produced it. Clicking an
   existing highlight reopens the same popover for recolouring, removal, or
   attaching a note. */

import { h, fill, $ } from '../core/dom.js';
import * as store from '../core/store.js';
import { paint } from '../render/prose.js';
import { toast } from './overlay.js';
import { clipText } from './capture.js';
import { activeNote } from './notepanel.js';
import { go } from '../core/router.js';

export const COLORS = [
  { id: 'yellow', var: '--hl-yellow', label: 'Yellow' },
  { id: 'blue', var: '--hl-blue', label: 'Blue' },
  { id: 'green', var: '--hl-green', label: 'Green' },
  { id: 'pink', var: '--hl-pink', label: 'Pink' },
];

let active = null;   // { root, qid, onChange }

/* ── offset arithmetic ────────────────────────────────────────────────── */

function blockOf(node) {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return el?.closest?.('[data-hl]') || null;
}

function offsetIn(block, node, offset) {
  if (node === block) {
    // Offset counts child nodes, not characters — sum the text before it.
    let n = 0;
    for (let i = 0; i < offset && i < block.childNodes.length; i++) {
      n += block.childNodes[i].textContent.length;
    }
    return n;
  }
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let n = 0, cur;
  while ((cur = walker.nextNode())) {
    if (cur === node) return n + offset;
    n += cur.nodeValue.length;
  }
  return n;
}

/** Current selection as { block, blockId, start, end, text } or null. */
function readSelection(root) {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const block = blockOf(range.startContainer);
  if (!block || block !== blockOf(range.endContainer)) return null;

  const text = block.textContent;
  let start = offsetIn(block, range.startContainer, range.startOffset);
  let end = offsetIn(block, range.endContainer, range.endOffset);
  if (start > end) [start, end] = [end, start];

  // Trim to word edges so a sloppy drag does not capture surrounding space.
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (end - start < 2) return null;

  return { block, blockId: block.dataset.hl, start, end, text: text.slice(start, end), rect: range.getBoundingClientRect() };
}

/* ── popover ──────────────────────────────────────────────────────────── */

function place(pop, rect) {
  pop.hidden = false;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const left = Math.max(10, Math.min(innerWidth - pw - 10, rect.left + rect.width / 2 - pw / 2));
  let top = rect.top - ph - 10;
  let flipped = false;
  if (top < 8) { top = rect.bottom + 10; flipped = true; }
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.setProperty('--arrow', `${Math.max(10, Math.min(pw - 10, rect.left + rect.width / 2 - left))}px`);
  pop.classList.toggle('sel-pop--below', flipped);
}

export function hidePopover() {
  const pop = $('#selPop');
  if (pop) { pop.hidden = true; pop.replaceChildren(); }
}

function swatch(color, onPick, current) {
  return h('button.sel-pop__sw', {
    type: 'button',
    title: color.label,
    'aria-label': `Highlight ${color.label.toLowerCase()}`,
    style: {
      background: `var(${color.var})`,
      borderColor: current === color.id ? 'rgba(255,255,255,.9)' : 'transparent',
    },
    onclick: () => onPick(color.id),
  });
}

/** Popover shown for a fresh selection. */
function popForSelection(sel, at) {
  const pop = $('#selPop');
  const { qid, root, onChange } = active;

  const add = (colorId) => {
    store.addHighlight(qid, { block: sel.blockId, start: sel.start, end: sel.end, color: colorId });
    repaintBlock(sel.blockId);
    getSelection().removeAllRanges();
    hidePopover();
    onChange?.();
  };

  fill(pop,
    COLORS.map((c) => swatch(c, add)),
    h('div.sel-pop__sep'),
    h('button.sel-pop__btn', {
      type: 'button',
      onclick: () => {
        store.addHighlight(qid, { block: sel.blockId, start: sel.start, end: sel.end, color: 'yellow' });
        repaintBlock(sel.blockId);
        clipText({ qid, text: sel.text, source: sourceLabel(sel.blockId, root), color: 'yellow' });
        getSelection().removeAllRanges();
        hidePopover();
        onChange?.();
      },
    }, 'Save to notebook'),
    h('button.sel-pop__btn', {
      type: 'button',
      onclick: async () => {
        try { await navigator.clipboard.writeText(sel.text); toast('Passage copied'); }
        catch { toast('Copying is blocked in this browser'); }
        hidePopover();
      },
    }, 'Copy'),
  );
  place(pop, at || sel.rect);
}

/** Popover shown when an existing highlight is clicked. */
function popForHighlight(markEl) {
  const pop = $('#selPop');
  const { qid, onChange } = active;
  const id = markEl.dataset.id;
  const blockId = markEl.closest('[data-hl]')?.dataset.hl;
  const hl = store.highlightsFor(qid).find((x) => x.id === id);
  if (!hl) return;

  const recolour = (colorId) => {
    store.updateHighlight(qid, id, { c: colorId });
    repaintBlock(blockId);
    hidePopover();
    onChange?.();
  };

  const linked = hl.note ? store.noteById(hl.note) : null;

  fill(pop,
    COLORS.map((c) => swatch(c, recolour, hl.c)),
    h('div.sel-pop__sep'),
    linked
      ? h('button.sel-pop__btn', { type: 'button', onclick: () => { hidePopover(); go(`/notebook/${linked.id}`); } }, 'Open note')
      : h('button.sel-pop__btn', {
        type: 'button',
        onclick: () => {
          clipText({ qid, text: markEl.textContent, source: sourceLabel(blockId, active.root) });
          store.updateHighlight(qid, id, { note: activeNote().id });
          repaintBlock(blockId);
          hidePopover();
          onChange?.();
        },
      }, 'Save to notebook'),
    h('button.sel-pop__btn', {
      type: 'button',
      onclick: () => {
        store.removeHighlight(qid, id);
        repaintBlock(blockId);
        hidePopover();
        onChange?.();
      },
    }, 'Remove'),
  );
  place(pop, markEl.getBoundingClientRect());
}

/* ── repaint ──────────────────────────────────────────────────────────── */

function repaintBlock(blockId) {
  if (!active) return;
  const el = active.root.querySelector(`[data-hl="${CSS.escape(blockId)}"]`);
  if (!el) return;
  const text = el.textContent;
  const ranges = store.highlightsFor(active.qid).filter((r) => r.b === blockId);
  el.replaceChildren(paint(text, ranges));
}

/** Human-readable origin of a passage, used as the clip's source line. */
function sourceLabel(blockId, root) {
  const el = root?.querySelector(`[data-hl="${CSS.escape(blockId)}"]`);
  const named = el?.dataset.hlLabel;
  if (named) return named;
  if (blockId.startsWith('stem')) return 'Clinical vignette';
  if (blockId.startsWith('why')) return 'Answer analysis';
  if (blockId.startsWith('teach')) return 'Explanation';
  if (blockId === 'summary') return 'Key point';
  if (blockId === 'objective') return 'Learning objective';
  if (blockId === 'ask') return 'Question';
  return 'Item';
}

/* ── attach ───────────────────────────────────────────────────────────── */

/**
 * Turn on highlighting inside `root` for question `qid`.
 * Returns a detach function.
 */
export function attachHighlighter(root, { qid, onChange } = {}) {
  active = { root, qid, onChange };

  // Paint whatever is already stored.
  const ranges = store.highlightsFor(qid);
  for (const el of root.querySelectorAll('[data-hl]')) {
    const mine = ranges.filter((r) => r.b === el.dataset.hl);
    if (mine.length) el.replaceChildren(paint(el.textContent, mine));
  }

  const onUp = (ev) => {
    if (ev.target.closest('.sel-pop')) return;
    if (ev.target.closest('mark.hl')) return;      // handled by click
    // Let the browser settle the selection before reading it.
    setTimeout(() => {
      const sel = readSelection(root);
      if (sel) popForSelection(sel);
      else if (!getSelection()?.toString()) hidePopover();
    }, 0);
  };

  const onClick = (ev) => {
    const mark = ev.target.closest('mark.hl');
    if (mark && root.contains(mark)) {
      ev.preventDefault();
      ev.stopPropagation();
      popForHighlight(mark);
    }
  };

  /* Right-click is where people reach for "do something with this selection",
     so it opens the same popover rather than the browser's menu. With nothing
     selected, and away from a highlight, the native menu is left alone. */
  const onContext = (ev) => {
    const mark = ev.target.closest('mark.hl');
    if (mark && root.contains(mark)) {
      ev.preventDefault();
      popForHighlight(mark);
      return;
    }
    const sel = readSelection(root);
    if (!sel) return;
    ev.preventDefault();
    // Anchored to the pointer, which is where a context menu is expected.
    popForSelection(sel, {
      left: ev.clientX, top: ev.clientY, bottom: ev.clientY, width: 0, height: 0,
    });
  };

  const onDocDown = (ev) => {
    if (ev.target.closest('.sel-pop') || ev.target.closest('mark.hl')) return;
    hidePopover();
  };

  const onScroll = () => hidePopover();

  root.addEventListener('mouseup', onUp);
  root.addEventListener('click', onClick);
  root.addEventListener('contextmenu', onContext);
  document.addEventListener('mousedown', onDocDown);
  root.closest('.runner__main, .view')?.addEventListener('scroll', onScroll, { passive: true });

  return function detach() {
    root.removeEventListener('mouseup', onUp);
    root.removeEventListener('click', onClick);
    root.removeEventListener('contextmenu', onContext);
    document.removeEventListener('mousedown', onDocDown);
    root.closest('.runner__main, .view')?.removeEventListener('scroll', onScroll);
    hidePopover();
    if (active?.root === root) active = null;
  };
}

/** Highlight the current selection with the keyboard shortcut. */
export function highlightSelection(colorId = 'yellow') {
  if (!active) return false;
  const sel = readSelection(active.root);
  if (!sel) return false;
  store.addHighlight(active.qid, {
    block: sel.blockId, start: sel.start, end: sel.end, color: colorId,
  });
  repaintBlock(sel.blockId);
  getSelection().removeAllRanges();
  hidePopover();
  active.onChange?.();
  return true;
}
