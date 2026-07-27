/* Minimal element builder.
   h('div.card#main', {onclick, dataset:{k:'v'}}, child, [children], 'text') */

const TAG_RE = /^([a-zA-Z][a-zA-Z0-9-]*)?((?:[.#][^.#]+)*)$/;
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'marker', 'ellipse', 'clipPath', 'use',
]);

export function h(spec, props, ...kids) {
  const m = TAG_RE.exec(spec);
  if (!m) throw new Error(`h: bad selector "${spec}"`);
  const tag = m[1] || 'div';
  const el = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);

  if (m[2]) {
    for (const part of m[2].match(/[.#][^.#]+/g) || []) {
      if (part[0] === '#') el.id = part.slice(1);
      else el.classList.add(part.slice(1));
    }
  }

  if (props && (props.constructor === Object)) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'dataset') { for (const [dk, dv] of Object.entries(v)) if (dv != null) el.dataset[dk] = dv; }
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'class') {
        // SVG elements expose className as a read-only SVGAnimatedString.
        const prev = el.getAttribute('class');
        el.setAttribute('class', prev ? `${prev} ${v}` : v);
      }
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'ref' && typeof v === 'function') v(el);
      else if (k in el && !SVG_TAGS.has(tag) && typeof v !== 'boolean') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  } else if (props !== null && props !== undefined) {
    kids.unshift(props);
  }

  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false || kid === true) continue;
    if (Array.isArray(kid)) append(el, kid);
    else if (kid instanceof Node) el.appendChild(kid);
    else el.appendChild(document.createTextNode(String(kid)));
  }
}

export function frag(...kids) {
  const f = document.createDocumentFragment();
  append(f, kids);
  return f;
}

/** Replace all children of `el`. */
export function fill(el, ...kids) {
  el.replaceChildren();
  append(el, kids);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Delegated listener: on(root, 'click', '.btn', (ev, el) => …) */
export function on(root, type, sel, fn) {
  root.addEventListener(type, (ev) => {
    const el = ev.target.closest(sel);
    if (el && root.contains(el)) fn(ev, el);
  });
}

export const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Focus trap + Escape handling for overlays. */
export function trap(box, onClose) {
  const sel = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
  const key = (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); onClose(); return; }
    if (ev.key !== 'Tab') return;
    const items = $$(sel, box).filter((e) => e.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  };
  box.addEventListener('keydown', key);
  return () => box.removeEventListener('keydown', key);
}
