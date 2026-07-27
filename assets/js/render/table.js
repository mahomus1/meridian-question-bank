/* Explanation tables and the vitals / laboratory blocks in a vignette. */

import { h } from '../core/dom.js';

/** Full table block from a spec, matching the figure block's shape. */
export function tableBlock(spec, { actions = null } = {}) {
  return h('div.xtab.clipable',
    actions && h('div.clipable__act', actions),
    h('div.xtab__head',
      h('div.xtab__title', spec.title),
      spec.caption && h('div.xtab__cap', spec.caption)),
    h('div.table-wrap',
      h('table',
        h('thead', h('tr', spec.columns.map((c) => h('th', c)))),
        h('tbody', spec.rows.map((row) => h('tr', row.map((cell) => h('td', cell))))))),
    spec.note && h('div.xtab__note', spec.note),
  );
}

/** Vitals strip. Values outside the expected range are called out. */
export function vitalsStrip(v) {
  if (!v) return null;
  const cells = [
    ['Temp', `${v.t} °C`, v.flags?.t],
    ['Pulse', `${v.hr}/min`, v.flags?.hr],
    ['BP', `${v.bp}`, v.flags?.bp],
    ['Resp', `${v.rr}/min`, v.flags?.rr],
    ['SpO₂', `${v.spo2}%`, v.flags?.spo2],
  ];
  return h('div.vitals', { role: 'group', 'aria-label': 'Vital signs' },
    cells.map(([k, val, abn]) => h(`div.vitals__c${abn ? '.vitals__c--abn' : ''}`,
      h('div.vitals__k', k),
      h('div.vitals__v', val))));
}

/** Laboratory panel inside a vignette. */
export function labTable(rows) {
  if (!rows || !rows.length) return null;
  return h('table.labtab',
    h('caption', 'Laboratory studies'),
    h('tbody', rows.map((r) => h(`tr${r.abn ? '.abn' : ''}`,
      h('td', r.name),
      h('td', r.value),
      h('td', r.unit),
      h('td', r.ref)))));
}
