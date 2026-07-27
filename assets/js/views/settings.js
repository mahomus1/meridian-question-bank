/* Settings: appearance, study defaults, and data ownership. */

import { h } from '../core/dom.js';
import * as store from '../core/store.js';
import { bank } from '../core/bank.js';
import { go } from '../core/router.js';
import { n, stamp, dateFull } from '../core/fmt.js';
import { toast, confirm } from '../features/overlay.js';
import { sampleNotice } from './parts.js';
import { showShortcuts } from './shortcuts.js';

export default async function settings() {
  const p = store.prefs();
  const el = h('div.wrap.wrap--narrow');

  const section = (title, ...rows) => h('div', { style: { marginBottom: '24px' } },
    h('div.shead', h('h2', title)),
    h('div.card', { style: { padding: '4px 18px' } }, rows));

  const row = (title, desc, control) => h('div.set-row',
    h('div.set-row__t', h('b', title), desc && h('span', desc)),
    h('div.set-row__c', control));

  /* appearance */
  el.appendChild(section('Appearance',
    row('Theme', 'Follows your system setting unless you choose otherwise.',
      h('div.seg',
        [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([k, label]) => h('button', {
          'aria-pressed': String(p.theme === k),
          onclick: (ev) => {
            store.setPref('theme', k);
            ev.currentTarget.parentElement.querySelectorAll('button')
              .forEach((b) => b.setAttribute('aria-pressed', 'false'));
            ev.currentTarget.setAttribute('aria-pressed', 'true');
          },
        }, label)))),

    row('Text size', 'Affects the clinical prose in questions and explanations.',
      h('div.seg',
        [[0.9, 'Small'], [1, 'Default'], [1.15, 'Large'], [1.3, 'Larger']].map(([v, label]) => h('button', {
          'aria-pressed': String(Math.abs((p.fontScale || 1) - v) < 0.01),
          onclick: (ev) => {
            store.setPref('fontScale', v);
            ev.currentTarget.parentElement.querySelectorAll('button')
              .forEach((b) => b.setAttribute('aria-pressed', 'false'));
            ev.currentTarget.setAttribute('aria-pressed', 'true');
          },
        }, label))))));

  /* study */
  el.appendChild(section('Studying',
    row('Show peer statistics', 'Display how often others answered correctly, and the answer distribution.',
      h('label.switch',
        h('input', {
          type: 'checkbox', checked: p.showPeer !== false,
          onchange: (ev) => store.setPref('showPeer', ev.target.checked),
        }),
        h('span.switch__track'))),

    row('Side panel in tests', 'Keep the highlights and notes panel open while working through a test.',
      h('label.switch',
        h('input', {
          type: 'checkbox', checked: p.showRail !== false,
          onchange: (ev) => store.setPref('showRail', ev.target.checked),
        }),
        h('span.switch__track'))),

    row('Default time per question', 'Used when you turn on timing in the test builder.',
      h('div.seg',
        [60, 75, 90, 120].map((s) => h('button', {
          'aria-pressed': String((p.timerSecs || 90) === s),
          onclick: (ev) => {
            store.setPref('timerSecs', s);
            ev.currentTarget.parentElement.querySelectorAll('button')
              .forEach((b) => b.setAttribute('aria-pressed', 'false'));
            ev.currentTarget.setAttribute('aria-pressed', 'true');
          },
        }, `${s}s`)))),

    row('Keyboard shortcuts', 'A full list of what you can do without the mouse.',
      h('button.btn', { onclick: () => showShortcuts() }, 'View shortcuts'))));

  /* data */
  const o = store.overall();
  el.appendChild(section('Your data',
    row('Stored locally', `Everything stays in this browser. Nothing is uploaded. Studying since ${dateFull(store.state.profile.since)}.`,
      h('span.badge', `${n(o.done)} answers · ${n(store.state.notes.length)} notes · ${n(store.highlightCount())} highlights`)),

    row('Export a backup', 'A single JSON file containing your answers, tests, highlights, and notes.',
      h('button.btn', {
        onclick: () => {
          const url = URL.createObjectURL(new Blob([store.exportAll()], { type: 'application/json' }));
          const a = h('a', { href: url, download: `meridian-backup-${stamp()}.json` });
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          toast('Backup downloaded');
        },
      }, 'Export')),

    row('Restore a backup', 'Replaces everything currently stored in this browser.',
      h('label.btn', { style: { cursor: 'pointer' } }, 'Choose file…',
        h('input', {
          type: 'file', accept: 'application/json,.json',
          style: { display: 'none' },
          onchange: async (ev) => {
            const file = ev.target.files?.[0];
            if (!file) return;
            const ok = await confirm({
              title: 'Restore this backup?',
              desc: 'Your current answers, tests, highlights, and notes will be replaced.',
              ok: 'Restore', danger: true,
            });
            ev.target.value = '';
            if (!ok) return;
            try {
              store.importAll(await file.text());
              toast('Backup restored');
              go('/');
            } catch (err) {
              toast(err.message || 'That file could not be read.');
            }
          },
        }))),

    row('Reset progress', 'Clears answers, marks, and tests. Your notebook and highlights are kept.',
      h('button.btn.btn--danger', {
        onclick: async () => {
          const ok = await confirm({
            title: 'Reset your progress?',
            desc: 'Answers, marked items, and test history will be cleared. Notes and highlights are kept.',
            ok: 'Reset progress', danger: true,
          });
          if (!ok) return;
          store.resetProgress();
          toast('Progress reset');
          go('/');
        },
      }, 'Reset'))));

  /* about */
  el.appendChild(h('div',
    h('div.shead', h('h2', 'About')),
    h('div.card.card--pad.stack-12',
      h('p.sm', h('b', 'Meridian'), ` — a board-style question bank of ${n(bank.index.meta.total)} items across ${bank.index.categories.length} categories, with custom test assembly, peer-referenced difficulty, and an integrated notebook.`),
      sampleNotice(),
      h('p.xs.muted', `Bank built ${bank.index.meta.built}. Runs entirely in your browser — no account, no server, no tracking.`))));

  return {
    title: 'Settings',
    subtitle: 'Appearance, study defaults, and your data',
    el,
  };
}
