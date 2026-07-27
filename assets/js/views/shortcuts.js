/* Keyboard reference. */

import { h } from '../core/dom.js';
import { modal } from '../features/overlay.js';

const mod = navigator.platform?.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';

const GROUPS = [
  {
    name: 'Anywhere', keys: [
      [[mod, 'K'], 'Search questions, notes, and pages'],
      [['/'], 'Search'],
      [['?'], 'This list'],
      [[mod, 'J'], 'Open or close the notebook'],
    ],
  },
  {
    name: 'While taking a test', keys: [
      [['A', '–', 'E'], 'Choose an answer'],
      [['1', '–', '5'], 'Choose an answer by position'],
      [['↵'], 'Submit, then move to the next item'],
      [['←'], 'Previous item'],
      [['→'], 'Next item'],
      [['M'], 'Mark this item for review'],
      [['H'], 'Highlight the selected passage'],
      [['L'], 'Open reference intervals'],
      [['\u2325', 'click'], 'Rule a choice out (or right-click it, or use the \u2298)'],
    ],
  },
  {
    name: 'Reading an item', keys: [
      [['H'], 'Highlight the selected passage'],
      [['M'], 'Mark for review'],
    ],
  },
  {
    name: 'In the notebook', keys: [
      [[mod, 'J'], 'Open or close the panel'],
      [[mod, 'B'], 'Bold'],
      [[mod, 'I'], 'Italic'],
      [[mod, 'U'], 'Underline'],
      [[mod, 'Z'], 'Undo'],
    ],
  },
];

export function showShortcuts() {
  modal({
    title: 'Keyboard shortcuts',
    desc: 'Meridian is built to be worked through without the mouse.',
    wide: true,
    body: h('div.stack-24',
      GROUPS.map((g) => h('div.stack-8',
        h('div.label', g.name),
        h('div.stack-4',
          g.keys.map(([keys, desc]) => h('div.row', { style: { gap: '14px' } },
            h('div.row', { style: { gap: '3px', width: '138px', flex: 'none' } },
              keys.map((k) => (k === '–' || k === 'click'
                ? h('span.xs.muted', k === 'click' ? ' + click' : '–')
                : h('span.kbd', k)))),
            h('span.sm', desc))))))),
    actions: (close) => [h('button.btn.btn--primary', { onclick: close }, 'Done')],
  });
}

export default async function shortcutsView() {
  showShortcuts();
  return { title: 'Shortcuts', el: h('div') };
}
