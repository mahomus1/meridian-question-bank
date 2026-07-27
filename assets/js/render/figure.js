/* Figure renderer.
   Every figure is a pure function of its spec, so the same spec renders inside
   an explanation and again inside a notebook clip. Colours come from CSS
   custom properties, so figures follow the theme without being redrawn. */

import { h } from '../core/dom.js';

/* ── text helpers ─────────────────────────────────────────────────────── */

/** Greedy wrap by estimated advance width. */
function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function svgText(x, y, lines, opts = {}) {
  const { cls = 'lbl', anchor = 'middle', lh = 14 } = opts;
  const t = h('text', { x, y, class: cls, 'text-anchor': anchor });
  lines.forEach((ln, i) => {
    t.appendChild(h('tspan', { x, dy: i === 0 ? 0 : lh }, ln));
  });
  return t;
}

const arrow = (x, y, dir = 'down') => {
  const p = dir === 'down' ? `${x - 4},${y - 5} ${x + 4},${y - 5} ${x},${y}`
    : `${x - 5},${y - 4} ${x - 5},${y + 4} ${x},${y}`;
  return h('polygon', { points: p, fill: 'currentColor', class: 'edge', stroke: 'none' });
};

// The `figsvg` class carries the styling, so a figure looks identical inside an
// explanation and inside a notebook clipping.
const svg = (w, hgt, ...kids) => h('svg.figsvg', {
  viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt,
  role: 'img', preserveAspectRatio: 'xMidYMid meet',
}, kids);

/* ── flow: vertical decision pathway ──────────────────────────────────── */

function flow(spec) {
  const W = 620, NW = 300, EW = 264, PADY = 11, LH = 14, GAP = 34;
  const cx = W / 2;
  const byId = Object.fromEntries(spec.nodes.map((n) => [n.id, n]));
  const order = ['a', 'b', 'c'].filter((id) => byId[id]);
  const ends = spec.nodes.filter((n) => !order.includes(n.id));

  const kids = [];
  let y = 6;
  const placed = {};

  for (const id of order) {
    const node = byId[id];
    const lines = wrap(node.label, Math.floor(NW / 6.1));
    const hgt = lines.length * LH + PADY * 2;
    const cls = node.kind === 'start' ? 'node node--start' : 'node';
    if (node.kind === 'decision') {
      kids.push(h('path', {
        d: `M ${cx} ${y} L ${cx + NW / 2} ${y + hgt / 2} L ${cx} ${y + hgt} L ${cx - NW / 2} ${y + hgt / 2} Z`,
        class: 'node',
      }));
    } else {
      kids.push(h('rect', {
        x: cx - NW / 2, y, width: NW, height: hgt, rx: 7, class: cls,
      }));
    }
    kids.push(svgText(cx, y + PADY + 10.5, lines, { lh: LH }));
    placed[id] = { y, hgt };
    y += hgt;
    if (id !== order[order.length - 1]) {
      kids.push(h('line', { x1: cx, y1: y, x2: cx, y2: y + GAP - 6, class: 'edge' }));
      kids.push(arrow(cx, y + GAP));
      y += GAP;
    }
  }

  // Branch out to the terminal nodes.
  const branchTop = y + 22;
  const xs = ends.length === 2 ? [W * 0.24, W * 0.76] : [cx];
  kids.push(h('line', { x1: cx, y1: y, x2: cx, y2: branchTop, class: 'edge' }));
  if (ends.length === 2) {
    kids.push(h('line', { x1: xs[0], y1: branchTop, x2: xs[1], y2: branchTop, class: 'edge' }));
  }

  let maxBottom = branchTop;
  ends.forEach((node, i) => {
    const x = xs[Math.min(i, xs.length - 1)];
    const lines = wrap(node.label, Math.floor(EW / 6.1));
    const hgt = lines.length * LH + PADY * 2;
    const top = branchTop + 30;
    kids.push(h('line', { x1: x, y1: branchTop, x2: x, y2: top - 6, class: 'edge' }));
    kids.push(arrow(x, top));
    kids.push(h('rect', {
      x: x - EW / 2, y: top, width: EW, height: hgt, rx: 7,
      class: node.kind === 'end' && i === 0 ? 'node node--end' : 'node',
    }));
    kids.push(svgText(x, top + PADY + 10.5, lines, { lh: LH }));

    const edge = spec.edges?.find((e) => e.to === node.id);
    if (edge?.label) {
      kids.push(h('rect', {
        x: x - 15, y: branchTop + 5, width: 30, height: 15, rx: 3,
        fill: 'var(--surface)', stroke: 'none',
      }));
      kids.push(svgText(x, branchTop + 16, [edge.label], { cls: 'lbl lbl--sm' }));
    }
    maxBottom = Math.max(maxBottom, top + hgt);
  });

  return svg(W, maxBottom + 8, ...kids);
}

/* ── bar: horizontal comparison ───────────────────────────────────────── */

function bar(spec) {
  const W = 620, LABEL = 208, PAD_R = 46, ROW = 34, TOP = 10;
  const max = Math.max(100, ...spec.series.map((s) => s.value));
  const trackW = W - LABEL - PAD_R;
  const kids = [];

  spec.series.forEach((s, i) => {
    const y = TOP + i * ROW;
    const lines = wrap(s.label, 32).slice(0, 2);
    kids.push(svgText(LABEL - 12, y + 13 - (lines.length - 1) * 5, lines,
      { anchor: 'end', cls: 'lbl', lh: 11 }));
    kids.push(h('rect', {
      x: LABEL, y: y + 4, width: trackW, height: 15, rx: 3,
      fill: 'var(--surface-3)',
    }));
    kids.push(h('rect', {
      x: LABEL, y: y + 4, width: Math.max(2, (s.value / max) * trackW), height: 15, rx: 3,
      class: i === 0 ? 'bar' : 'bar-2',
    }));
    kids.push(svgText(LABEL + (s.value / max) * trackW + 8, y + 16, [`${s.value}%`],
      { anchor: 'start', cls: 'lbl lbl--sm' }));
  });

  const hgt = TOP + spec.series.length * ROW + 16;
  if (spec.yLabel) {
    kids.push(svgText(LABEL, hgt - 2, [spec.yLabel], { anchor: 'start', cls: 'lbl lbl--sm' }));
  }
  return svg(W, hgt, ...kids);
}

/* ── line: two-series trend ───────────────────────────────────────────── */

function line(spec) {
  const W = 620, H = 262, L = 46, R = 16, T = 14, B = 62;
  const pw = W - L - R, ph = H - T - B;
  const all = spec.series.flatMap((s) => s.points);
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y1 = Math.max(100, Math.max(...ys));
  const px = (x) => L + ((x - x0) / (x1 - x0 || 1)) * pw;
  const py = (y) => T + ph - (y / y1) * ph;
  const kids = [];

  for (let i = 0; i <= 4; i++) {
    const y = T + (ph / 4) * i;
    kids.push(h('line', { x1: L, y1: y, x2: W - R, y2: y, class: 'grid' }));
    kids.push(svgText(L - 9, y + 3.5, [String(Math.round(y1 - (y1 / 4) * i))],
      { anchor: 'end', cls: 'lbl lbl--sm' }));
  }
  kids.push(h('line', { x1: L, y1: T + ph, x2: W - R, y2: T + ph, class: 'ax' }));

  for (let x = x0; x <= x1; x++) {
    kids.push(svgText(px(x), T + ph + 17, [String(x)], { cls: 'lbl lbl--sm' }));
  }

  spec.series.forEach((s, i) => {
    const d = s.points.map((p, j) => `${j ? 'L' : 'M'} ${px(p[0]).toFixed(1)} ${py(p[1]).toFixed(1)}`).join(' ');
    kids.push(h('path', { d, class: i === 0 ? 'ln' : 'ln-2' }));
    s.points.forEach((p) => kids.push(h('circle', {
      cx: px(p[0]), cy: py(p[1]), r: 2.8,
      fill: 'var(--surface)', stroke: i === 0 ? 'var(--blue)' : 'var(--ink-4)', 'stroke-width': 1.6,
    })));
  });

  // legend
  spec.series.forEach((s, i) => {
    const x = L + i * 170, y = H - 10;
    kids.push(h('line', {
      x1: x, y1: y - 4, x2: x + 18, y2: y - 4,
      class: i === 0 ? 'ln' : 'ln-2',
    }));
    kids.push(svgText(x + 24, y, [s.name], { anchor: 'start', cls: 'lbl lbl--sm' }));
  });
  if (spec.xLabel) kids.push(svgText(W - R, H - 10, [spec.xLabel], { anchor: 'end', cls: 'lbl lbl--sm' }));

  return svg(W, H, ...kids);
}

/* ── panels: schematic study strip ────────────────────────────────────── */

function panels(spec) {
  const W = 620, PW = 190, PH = 132, GAP = 25, T = 8;
  const kids = [];
  const tones = { dark: 'var(--ink-3)', mid: 'var(--ink-4)', light: 'var(--surface-3)' };

  spec.panels.forEach((p, i) => {
    const x = i * (PW + GAP);
    kids.push(h('rect', { x, y: T, width: PW, height: PH, rx: 5, fill: tones[p.tone] || 'var(--surface-3)', opacity: .32 }));
    kids.push(h('rect', { x, y: T, width: PW, height: PH, rx: 5, fill: 'none', stroke: 'var(--rule-2)' }));

    // Abstract texture so the panel reads as an image placeholder, not a gap.
    for (let k = 0; k < 5; k++) {
      kids.push(h('ellipse', {
        cx: x + PW * (0.22 + 0.16 * k), cy: T + PH * (0.35 + 0.1 * ((k * 7) % 4)),
        rx: 16 + (k % 3) * 9, ry: 11 + (k % 2) * 7,
        fill: 'var(--ink-4)', opacity: .13,
      }));
    }

    kids.push(h('rect', { x: x + 7, y: T + 7, width: 19, height: 17, rx: 3, fill: 'var(--ink)', opacity: .78 }));
    const tag = svgText(x + 16.5, T + 19, [p.label], { cls: 'lbl', anchor: 'middle' });
    tag.setAttribute('fill', 'var(--surface)');
    kids.push(tag);

    (p.marks || []).forEach((mk) => {
      const mx = x + PW * mk.x, my = T + PH * mk.y;
      kids.push(h('circle', { cx: mx, cy: my, r: 11, class: 'mark' }));
      kids.push(svgText(mx, my - 15, [mk.note], { cls: 'lbl lbl--sm' }));
    });

    const lines = wrap(p.caption, 30).slice(0, 2);
    kids.push(svgText(x + PW / 2, T + PH + 15, lines, { cls: 'lbl lbl--sm', lh: 11 }));
  });

  return svg(W, T + PH + 42, ...kids);
}

/* ── timeline: vertical course of illness ─────────────────────────────── */

function timeline(spec) {
  const W = 620, ROW = 46, X = 96, T = 12;
  const kids = [];
  const n = spec.events.length;

  kids.push(h('line', { x1: X, y1: T + 8, x2: X, y2: T + (n - 1) * ROW + 8, class: 'edge' }));

  spec.events.forEach((ev, i) => {
    const y = T + i * ROW + 8;
    kids.push(h('circle', {
      cx: X, cy: y, r: 5.5,
      fill: i === n - 1 ? 'var(--green-tint)' : i === 0 ? 'var(--blue-tint)' : 'var(--surface)',
      stroke: i === n - 1 ? 'var(--green)' : 'var(--blue)', 'stroke-width': 1.8,
    }));
    kids.push(svgText(X - 16, y + 4, [ev.t], { anchor: 'end', cls: 'lbl' }));
    const lines = wrap(ev.label, 52).slice(0, 2);
    kids.push(svgText(X + 16, y + 4 - (lines.length - 1) * 6, lines, { anchor: 'start', cls: 'lbl', lh: 13 }));
  });

  return svg(W, T + n * ROW + 12, ...kids);
}

/* ── trace: stylised waveform ─────────────────────────────────────────── */

function trace(spec) {
  const W = 620, H = 168, L = 12, R = 12, T = 22, B = 34;
  const pw = W - L - R, ph = H - T - B;
  const mid = T + ph / 2;
  const kids = [];

  kids.push(h('rect', { x: L, y: T, width: pw, height: ph, rx: 4, fill: 'var(--surface-2)' }));
  for (let i = 1; i < 8; i++) {
    const x = L + (pw / 8) * i;
    kids.push(h('line', { x1: x, y1: T, x2: x, y2: T + ph, class: 'grid' }));
  }
  kids.push(h('line', { x1: L, y1: mid, x2: W - R, y2: mid, class: 'grid' }));

  let d = '';
  if (spec.kind === 'ecg') {
    const beat = pw / 5;
    for (let b = 0; b < 5; b++) {
      const x = L + b * beat;
      const u = (f) => x + beat * f;
      d += `${b ? 'L' : 'M'} ${x} ${mid} `
        + `L ${u(.12)} ${mid} Q ${u(.17)} ${mid - 9} ${u(.22)} ${mid} `
        + `L ${u(.3)} ${mid} L ${u(.34)} ${mid + 7} L ${u(.4)} ${mid - 40} `
        + `L ${u(.46)} ${mid + 15} L ${u(.5)} ${mid} `
        + `L ${u(.62)} ${mid} Q ${u(.7)} ${mid - 15} ${u(.78)} ${mid} L ${u(1)} ${mid} `;
    }
  } else if (spec.kind === 'spirometry') {
    d = `M ${L + 20} ${mid + ph * .3} `
      + `C ${L + 50} ${T + 8} ${L + 110} ${T + 4} ${L + 150} ${T + 18} `
      + `C ${L + 260} ${T + 46} ${L + 380} ${mid + ph * .22} ${L + pw - 30} ${mid + ph * .3} `
      + `C ${L + 380} ${mid + ph * .46} ${L + 150} ${mid + ph * .5} ${L + 20} ${mid + ph * .3} Z`;
  } else {
    const step = pw / 60;
    for (let i = 0; i <= 60; i++) {
      const x = L + i * step;
      const y = mid - Math.sin(i / 3.1) * 20 - Math.sin(i / 1.3) * 6;
      d += `${i ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)} `;
    }
  }
  kids.push(h('path', { d, class: 'trace', fill: spec.kind === 'spirometry' ? 'var(--blue-tint)' : 'none' }));

  (spec.annotations || []).forEach((a) => {
    const x = L + pw * a.at;
    kids.push(h('line', { x1: x, y1: T - 4, x2: x, y2: T + ph + 4, stroke: 'var(--red)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
    kids.push(svgText(x, T - 9, wrap(a.label, 30).slice(0, 1), { cls: 'lbl lbl--sm' }));
  });

  kids.push(svgText(L, H - 12, [spec.kind === 'ecg' ? '25 mm/s · schematic'
    : spec.kind === 'spirometry' ? 'Flow against volume · schematic' : 'Continuous trace · schematic'],
  { anchor: 'start', cls: 'lbl lbl--sm' }));

  return svg(W, H, ...kids);
}

/* ── dispatch ─────────────────────────────────────────────────────────── */

const RENDERERS = { flow, bar, line, panels, timeline, trace };

/** Render just the SVG for a figure spec. */
export function figureSvg(spec) {
  const fn = RENDERERS[spec.type];
  if (!fn) return h('div.muted.xs', `Unsupported figure type: ${spec.type}`);
  try {
    return fn(spec);
  } catch (err) {
    console.error('figure render failed', spec.type, err);
    return h('div.muted.xs', 'This figure could not be drawn.');
  }
}

/** Full figure block: title, canvas, caption, optional legend and actions. */
export function figureBlock(spec, { actions = null, id = null } = {}) {
  return h('figure.fig.clipable', { dataset: { fig: id || spec.type } },
    actions && h('div.clipable__act', actions),
    h('div.fig__head', h('figcaption.fig__title', spec.title)),
    h('div.fig__canvas', figureSvg(spec)),
    h('div.fig__cap',
      spec.caption,
      spec.legend && h('div.fig__legend', spec.legend.map((l) => h('span', l)))),
  );
}
