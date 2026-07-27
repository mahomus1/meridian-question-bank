/* Highlightable prose.

   Every passage a reader can mark is rendered from plain text into a block
   carrying a stable id. Highlights are stored as character offsets into that
   text, so they survive reloads, theme changes, and re-renders. Painting works
   on a per-character map, which makes overlapping and nested selections
   collapse predictably instead of producing tangled markup. */

import { h, frag } from '../core/dom.js';

/**
 * Build a fragment for `text` with `ranges` painted over it.
 * @param {string} text
 * @param {Array<{id:string,s:number,e:number,c:string,note?:string}>} ranges
 */
export function paint(text, ranges = []) {
  if (!ranges.length) return frag(text);

  const len = text.length;
  const slot = new Array(len).fill(null);
  // Later ranges win where they overlap, so recolouring is simply re-adding.
  for (const r of ranges) {
    const s = Math.max(0, Math.min(len, r.s));
    const e = Math.max(0, Math.min(len, r.e));
    for (let i = s; i < e; i++) slot[i] = r;
  }

  const out = frag();
  let i = 0;
  while (i < len) {
    const cur = slot[i];
    let j = i + 1;
    while (j < len && slot[j] === cur) j++;
    const chunk = text.slice(i, j);
    if (cur) {
      out.appendChild(h('mark.hl', {
        dataset: { c: cur.c || 'yellow', id: cur.id, note: cur.note ? '1' : null },
        title: cur.note ? 'Highlight with a note — click to open' : 'Click to change or remove',
      }, chunk));
    } else {
      out.appendChild(document.createTextNode(chunk));
    }
    i = j;
  }
  return out;
}

/**
 * A highlightable block.
 * @param {string} tag       selector passed to h(), e.g. 'p' or 'div.expl__lead'
 * @param {string} text      plain text content
 * @param {string} blockId   stable id used to anchor highlights
 * @param {Array}  ranges    highlights belonging to this block
 */
export function block(tag, text, blockId, ranges = []) {
  const el = h(tag, { dataset: { hl: blockId } });
  el.appendChild(paint(text, ranges.filter((r) => r.b === blockId)));
  return el;
}

/** Repaint one block in place after its highlights change. */
export function repaint(root, blockId, text, ranges) {
  const el = root.querySelector(`[data-hl="${CSS.escape(blockId)}"]`);
  if (!el) return;
  el.replaceChildren(paint(text, ranges.filter((r) => r.b === blockId)));
}

/** Plain text of a block, used when resolving a selection to offsets. */
export const textOf = (el) => el.textContent;

/* ── lightweight markdown for notebook bodies ─────────────────────────── */

const inline = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

/**
 * Renders a practical subset: headings, lists, quotes, rules, tables, and
 * emphasis. Used to migrate legacy markdown notes into the document editor and
 * to render any markdown a reader pastes in.
 */
export function markdown(src) {
  const lines = String(src || '').split('\n');
  const out = [];
  let list = null;   // 'ul' | 'ol'
  let para = [];

  const closePara = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
  };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const ln = raw.trimEnd();
    if (!ln.trim()) { closePara(); closeList(); continue; }

    // Pipe table: a header row, a separator, then body rows.
    if (ln.trim().startsWith('|') && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      closePara(); closeList();
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(ln);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { body.push(cells(lines[i])); i++; }
      i--;
      out.push('<div class="md-table"><table><thead><tr>'
        + head.map((c) => `<th>${inline(c)}</th>`).join('')
        + '</tr></thead><tbody>'
        + body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
        + '</tbody></table></div>');
      continue;
    }

    const head = /^(#{1,3})\s+(.*)$/.exec(ln);
    if (head) {
      closePara(); closeList();
      out.push(`<h${head[1].length}>${inline(head[2])}</h${head[1].length}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(ln)) {
      closePara();
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(ln.replace(/^\s*[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(ln)) {
      closePara();
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(ln.replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
      continue;
    }
    if (/^>\s?/.test(ln)) {
      closePara(); closeList();
      out.push(`<blockquote>${inline(ln.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(ln.trim())) {
      closePara(); closeList(); out.push('<hr class="divider">');
      continue;
    }
    closeList();
    para.push(ln.trim());
  }
  closePara(); closeList();
  return out.join('\n');
}

/** First meaningful line of a note body, for list previews. */
export function excerpt(src, max = 140) {
  const flat = String(src || '')
    .replace(/[#>*`_]/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Plain text of a document, for previews and search. */
export function htmlToText(html) {
  const box = document.createElement('div');
  box.innerHTML = String(html || '');
  box.querySelectorAll('.doc-clip').forEach((el) => {
    el.replaceWith(document.createTextNode(` ${el.dataset.summary || ''} `));
  });
  // Blocks carry no whitespace of their own, so their text would otherwise
  // run together — "hyperkalaemiaCalcium first".
  box.querySelectorAll('p, div, li, blockquote, h1, h2, h3, tr').forEach((el) => {
    el.appendChild(document.createTextNode(' '));
  });
  return box.textContent.replace(/\s+/g, ' ').trim();
}

/**
 * Serialise the document editor back to Markdown for export.
 * `clipMd` turns a clip id into its markdown form.
 */
export function htmlToMarkdown(html, clipMd = () => '') {
  const box = document.createElement('div');
  box.innerHTML = String(html || '');
  const out = [];

  const inlineMd = (node) => {
    let s = '';
    for (const n of node.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) { s += n.nodeValue; continue; }
      const tag = n.tagName?.toLowerCase();
      const inner = inlineMd(n);
      if (tag === 'b' || tag === 'strong') s += `**${inner}**`;
      else if (tag === 'i' || tag === 'em') s += `*${inner}*`;
      else if (tag === 'code') s += `\`${inner}\``;
      else if (tag === 'a') s += `[${inner}](${n.getAttribute('href') || ''})`;
      else if (tag === 'br') s += '\n';
      else s += inner;
    }
    return s;
  };

  // contenteditable wraps new blocks in <div> in some browsers, so unknown
  // wrappers are walked through rather than flattened into a paragraph.
  const emit = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.classList.contains('doc-clip')) { out.push(clipMd(el.dataset.clip), ''); return; }
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      out.push(`${'#'.repeat(Number(tag[1]))} ${inlineMd(el)}`, '');
    } else if (tag === 'ul' || tag === 'ol') {
      [...el.children].forEach((li, i) => out.push(`${tag === 'ul' ? '-' : `${i + 1}.`} ${inlineMd(li)}`));
      out.push('');
    } else if (tag === 'blockquote') {
      const src = el.getAttribute('data-src');
      out.push(`> ${inlineMd(el).trim().replace(/\n/g, '\n> ')}`);
      if (src) out.push('>', `> — ${src}`);
      out.push('');
    } else if (tag === 'hr') {
      out.push('---', '');
    } else if ((tag === 'div' || tag === 'p') && el.querySelector('ul, ol, blockquote, h1, h2, h3')) {
      [...el.children].forEach(emit);
    } else {
      const t = inlineMd(el).trim();
      if (t) out.push(t, '');
    }
  };

  [...box.children].forEach(emit);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
