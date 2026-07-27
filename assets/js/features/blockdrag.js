/* Reordering blocks in a note document.

   A single handle follows whichever block the pointer is over, living outside
   the editable area so it never becomes part of the stored document. Dragging
   runs on pointer events rather than native drag-and-drop, which inside a
   contenteditable fights the browser's own text dragging. */

import { h } from '../core/dom.js';

/**
 * @param {HTMLElement} wrap    positioned container holding the document
 * @param {HTMLElement} doc     the contenteditable element
 * @param {Function} onReorder  called after a block moves
 * @returns {Function} detach
 */
export function enableBlockDrag(wrap, doc, onReorder) {
  const handle = h('div.doc-handle', {
    title: 'Drag to move this block',
    'aria-hidden': 'true',
  });
  const line = h('div.doc-dropline');
  wrap.append(handle, line);

  let hovered = null;
  let dragging = null;
  let drop = null;
  let scroller = null;
  let autoTimer = null;

  const blocks = () => [...doc.children];

  function placeHandle(block) {
    hovered = block || null;
    if (!block) { handle.classList.remove('on'); return; }
    const wr = wrap.getBoundingClientRect();
    const br = block.getBoundingClientRect();
    handle.style.top = `${br.top - wr.top + Math.min(6, (br.height - 22) / 2)}px`;
    handle.classList.add('on');
  }

  const onOver = (ev) => {
    if (dragging) return;
    const b = ev.target.closest?.('.doc > *');
    if (b && doc.contains(b)) placeHandle(b);
  };

  const onOut = (ev) => {
    if (dragging) return;
    if (!ev.relatedTarget || !wrap.contains(ev.relatedTarget)) placeHandle(null);
  };

  /* ── dragging ─────────────────────────────────────────────────────────── */

  function onDown(ev) {
    if (!hovered || ev.button !== 0) return;
    ev.preventDefault();
    dragging = hovered;
    drop = null;
    dragging.classList.add('is-dragging');
    document.body.classList.add('dragging-block');
    scroller = doc.closest('.nb-edit-body') || doc.parentElement;

    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp, { once: true });
    addEventListener('keydown', onKey, true);
  }

  function onMove(ev) {
    if (!dragging) return;

    // Find the gap the pointer is closest to.
    let target = null, before = false;
    for (const b of blocks()) {
      if (b === dragging) continue;
      const r = b.getBoundingClientRect();
      if (ev.clientY < r.top + r.height / 2) { target = b; before = true; break; }
      target = b; before = false;
    }
    drop = target ? { target, before } : null;

    const wr = wrap.getBoundingClientRect();
    if (drop) {
      const r = drop.target.getBoundingClientRect();
      line.style.top = `${(drop.before ? r.top : r.bottom) - wr.top}px`;
      line.classList.add('on');
    } else {
      line.classList.remove('on');
    }

    // Nudge the page when dragging near an edge.
    const sr = scroller?.getBoundingClientRect();
    clearInterval(autoTimer);
    if (sr) {
      const up = ev.clientY - sr.top < 48;
      const down = sr.bottom - ev.clientY < 48;
      if (up || down) {
        autoTimer = setInterval(() => { scroller.scrollTop += up ? -14 : 14; }, 16);
      }
    }
  }

  function finish(moved) {
    clearInterval(autoTimer);
    removeEventListener('pointermove', onMove);
    removeEventListener('keydown', onKey, true);
    dragging?.classList.remove('is-dragging');
    document.body.classList.remove('dragging-block');
    line.classList.remove('on');
    const block = dragging;
    dragging = null;
    drop = null;
    placeHandle(null);
    if (moved && block) onReorder?.(block);
  }

  function onUp() {
    if (!dragging) return;
    let moved = false;
    if (drop && drop.target !== dragging) {
      if (drop.before) doc.insertBefore(dragging, drop.target);
      else drop.target.after(dragging);
      moved = true;
    }
    // A block must never be left with nowhere to type after it.
    if (doc.lastElementChild && !isText(doc.lastElementChild)) {
      doc.appendChild(h('p', h('br')));
      moved = true;
    }
    if (doc.firstElementChild && !isText(doc.firstElementChild)) {
      doc.insertBefore(h('p', h('br')), doc.firstElementChild);
      moved = true;
    }
    finish(moved);
  }

  function onKey(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); }
  }

  const isText = (el) => !el.classList.contains('doc-clip');

  /* ── wiring ───────────────────────────────────────────────────────────── */

  wrap.addEventListener('pointerover', onOver);
  wrap.addEventListener('pointerout', onOut);
  handle.addEventListener('pointerdown', onDown);
  const reposition = () => { if (hovered && !dragging) placeHandle(hovered); };
  doc.addEventListener('input', reposition);

  return function detach() {
    clearInterval(autoTimer);
    wrap.removeEventListener('pointerover', onOver);
    wrap.removeEventListener('pointerout', onOut);
    handle.removeEventListener('pointerdown', onDown);
    doc.removeEventListener('input', reposition);
    removeEventListener('pointermove', onMove);
    removeEventListener('keydown', onKey, true);
    document.body.classList.remove('dragging-block');
    handle.remove();
    line.remove();
  };
}
