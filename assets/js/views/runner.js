/* The test runner.

   Tutor mode reveals the explanation the moment an answer is submitted; timed
   mode locks answers away until the end. Both share one item renderer, so
   highlighting, clipping, and note-taking behave identically wherever a reader
   meets a question. */

import { h, fill, $ } from '../core/dom.js';
import * as store from '../core/store.js';
import { getQuestion, meta, prefetch, loadReference } from '../core/bank.js';
import { go } from '../core/router.js';
import { clock, secs } from '../core/fmt.js';
import { block } from '../render/prose.js';
import { vignette, explanation as explanationBlock } from '../render/item.js';
import { attachHighlighter, highlightSelection, hidePopover } from '../features/highlight.js';
import { clipFigure, clipTable, clipQuestion, clipText, noteForQuestion } from '../features/capture.js';
import { toast, confirm, modal } from '../features/overlay.js';
import { diffPips, catTag, empty } from './parts.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

export default async function runner({ id }) {
  const test = store.testById(id);
  if (!test) {
    return {
      title: 'Test not found',
      el: h('div.wrap', empty({
        mark: '?', title: 'That test no longer exists',
        text: 'It may have been deleted from your history.',
        action: h('a.btn.btn--primary', { href: '#/create' }, 'Create a new test'),
      })),
    };
  }
  if (test.status === 'done') { go(`/results/${test.id}`, { replace: true }); return { title: 'Results', el: h('div') }; }

  const tutor = test.mode === 'tutor';
  let idx = Math.min(test.idx || 0, test.qids.length - 1);
  let q = null;
  let detachHl = null;
  let itemStart = 0;
  let ticker = null;
  let remaining = test.timerSecs || 0;
  let showRail = store.prefs().showRail !== false;

  /* ── skeleton ───────────────────────────────────────────────────────── */

  const barHost = h('div.runner__bar');
  const mainHost = h('div.runner__main');
  const railHost = h('aside.runner__rail');
  const footHost = h('div.runner__foot');
  const bodyHost = h('div.runner__body', mainHost, railHost);
  const el = h('div.runner', barHost, bodyHost, footHost);

  const applyRail = () => {
    bodyHost.classList.toggle('has-rail', showRail);
    railHost.hidden = !showRail;
  };
  applyRail();

  /* ── timing ─────────────────────────────────────────────────────────── */

  const qid = () => test.qids[idx];

  function bankTime() {
    if (!itemStart) return;
    const spent = Math.round(performance.now() - itemStart);
    test.spent[qid()] = (test.spent[qid()] || 0) + spent;
    test.elapsed = (test.elapsed || 0) + spent;
    itemStart = performance.now();
  }

  function startTicker() {
    clearInterval(ticker);
    if (!test.timerSecs) {
      ticker = setInterval(() => { drawBar(); }, 1000);
      return;
    }
    ticker = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(ticker);
        onTimeUp();
        return;
      }
      drawTimer();
    }, 1000);
  }

  function onTimeUp() {
    if (tutor && !test.locked[qid()]) {
      if (test.picks[qid()]) submit();
      else { toast('Time is up for this question.'); submit(true); }
    } else if (idx < test.qids.length - 1) {
      toast('Time is up — moving on.');
      goTo(idx + 1);
    } else {
      finish();
    }
  }

  /* ── top bar ────────────────────────────────────────────────────────── */

  function drawBar() {
    const answered = test.qids.filter((x) => test.picks[x]).length;
    fill(barHost,
      h('div.runner__pos', `Item ${idx + 1}`, h('small', ` of ${test.qids.length}`)),
      h('div.pdots', { role: 'group', 'aria-label': 'Progress' },
        test.qids.map((x, i) => {
          const picked = test.picks[x];
          const locked = test.locked[x];
          const a = store.answerFor(x);
          let cls = 'pdot';
          if (i === idx) cls += ' pdot--now';
          else if (store.isMarked(x)) cls += ' pdot--mark';
          else if (locked && a) cls += a.ok ? ' pdot--right' : ' pdot--wrong';
          else if (picked) cls += ' pdot--done';
          return h(`button.${cls.split(' ').join('.')}`, {
            type: 'button',
            title: `Item ${i + 1}${picked ? ' · answered' : ''}${store.isMarked(x) ? ' · marked' : ''}`,
            'aria-label': `Go to item ${i + 1}`,
            onclick: () => goTo(i),
          });
        })),
      h('div.push.row', { style: { gap: '8px' } },
        h('span.xs.muted', `${answered}/${test.qids.length} answered`),
        timerEl()),
    );
  }

  let timerNode = null;
  function timerEl() {
    timerNode = h('div.timer', { title: test.timerSecs ? 'Time left on this question' : 'Time on this test' });
    drawTimer();
    return timerNode;
  }
  function drawTimer() {
    if (!timerNode) return;
    if (test.timerSecs) {
      timerNode.textContent = secs(Math.max(0, remaining));
      timerNode.classList.toggle('timer--warn', remaining <= 20 && remaining > 10);
      timerNode.classList.toggle('timer--over', remaining <= 10);
    } else {
      const live = test.elapsed + (itemStart ? performance.now() - itemStart : 0);
      timerNode.textContent = clock(live);
    }
  }

  /* ── item ───────────────────────────────────────────────────────────── */

  async function load(i) {
    idx = i;
    test.idx = i;
    remaining = test.timerSecs || 0;
    detachHl?.(); detachHl = null;
    hidePopover();

    const id2 = qid();
    fill(mainHost, h('div.runner__inner', h('p.muted.sm', 'Loading item…')));
    try {
      q = await getQuestion(id2);
    } catch (err) {
      fill(mainHost, h('div.runner__inner', empty({
        mark: '!', title: 'This item could not be loaded', text: err.message,
      })));
      return;
    }

    itemStart = performance.now();
    drawItem();
    drawBar();
    drawFoot();
    drawRail();
    startTicker();
    mainHost.scrollTop = 0;

    // Keep the next few items warm.
    prefetch(test.qids.slice(i + 1, i + 4));
  }

  function drawItem() {
    const m = meta(q.id);
    const locked = !!test.locked[q.id];
    const picked = test.picks[q.id];
    const reveal = tutor && locked;
    const marked = store.isMarked(q.id);

    const inner = h('div.runner__inner', { dataset: { hlRoot: q.id } },

      h('div.item-head',
        h('span.item-head__id', q.id),
        catTag(q.cat),
        h('span.badge.badge--outline', q.archetypeLabel),
        reveal ? diffPips(q.diff) : null,
        h('div.push.row', { style: { gap: '6px' } },
          h('button.btn.btn--sm', {
            'aria-pressed': String(marked),
            style: marked ? { color: 'var(--amber)', borderColor: 'var(--amber)' } : null,
            onclick: (ev) => {
              const on = store.toggleMark(q.id);
              ev.currentTarget.setAttribute('aria-pressed', String(on));
              ev.currentTarget.style.color = on ? 'var(--amber)' : '';
              ev.currentTarget.style.borderColor = on ? 'var(--amber)' : '';
              drawBar();
            },
          }, marked ? '★ Marked' : '☆ Mark'),
          h('button.btn.btn--sm', {
            title: 'Save this question to your notebook',
            onclick: () => clipQuestion({ qid: q.id }),
          }, 'Save item'))),

      vignette(q),

      /* choices */
      h('div.choices', { role: 'group', 'aria-label': 'Answer choices' },
        q.choices.map((c) => choiceRow(c, { locked, picked, reveal }))),

      reveal ? explanation() : null,
    );

    fill(mainHost, inner);

    detachHl = attachHighlighter(inner, {
      qid: q.id,
      onChange: () => drawRail(),
    });
  }

  function choiceRow(c, { locked, picked, reveal }) {
    const struck = (test.struck[q.id] || []).includes(c.k);
    const isPick = picked === c.k;
    const isKey = c.k === q.key;

    let cls = 'button.choice';
    if (struck) cls += '.choice--struck';
    if (reveal && isKey) cls += '.choice--right';
    else if (reveal && isPick && !isKey) cls += '.choice--wrong';

    return h(cls, {
      type: 'button',
      'aria-pressed': String(isPick),
      disabled: locked && tutor,
      onclick: (ev) => {
        if (ev.altKey) { strike(c.k); return; }
        if (locked && tutor) return;
        pick(c.k);
      },
      oncontextmenu: (ev) => { ev.preventDefault(); strike(c.k); },
    },
      h('span.choice__k', c.k),
      h('span.choice__t', c.t),
      reveal && store.prefs().showPeer
        ? h('span.choice__pct', `${c.share}%`)
        : null,
      reveal ? h('span.choice__bar', {
        style: { width: `${c.share}%`, background: isKey ? '#3f8f5f' : 'var(--ink-4)' },
      }) : null);
  }

  function explanation() {
    return explanationBlock(q, {
      picked: test.picks[q.id] || null,
      mySec: Math.round((test.spent[q.id] || 0) / 1000),
      showPeer: store.prefs().showPeer,
      onClipFigure: () => clipFigure({ qid: q.id, spec: q.figure }),
      onClipTable: () => clipTable({ qid: q.id, spec: q.table }),
    });
  }

  /* ── answer handling ────────────────────────────────────────────────── */

  function pick(letter) {
    test.picks[q.id] = letter;
    store.updateTest(test.id, {});
    if (tutor) drawItem(); else { drawItem(); }
    drawBar();
    drawFoot();
  }

  function strike(letter) {
    const list = test.struck[q.id] || (test.struck[q.id] = []);
    const i = list.indexOf(letter);
    if (i < 0) list.push(letter); else list.splice(i, 1);
    if (test.picks[q.id] === letter && i < 0) delete test.picks[q.id];
    store.updateTest(test.id, {});
    drawItem();
    drawFoot();
  }

  function submit(omitted = false) {
    if (test.locked[q.id]) return;
    const choice = omitted ? null : test.picks[q.id];
    if (!omitted && !choice) { toast('Choose an answer first.'); return; }

    bankTime();
    test.locked[q.id] = true;
    const ok = choice === q.key;
    store.recordAnswer(q.id, choice, ok, test.spent[q.id] || 0, test.id);
    store.updateTest(test.id, {});
    clearInterval(ticker);

    drawItem();
    drawBar();
    drawFoot();
    drawRail();
    mainHost.querySelector('.expl')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function goTo(i) {
    if (i < 0 || i >= test.qids.length) return;
    bankTime();

    // Timed mode records the answer as the reader leaves the item.
    if (!tutor) {
      const cur = qid();
      const choice = test.picks[cur];
      if (choice && !test.locked[cur]) {
        test.locked[cur] = true;
        store.recordAnswer(cur, choice, choice === q?.key, test.spent[cur] || 0, test.id);
      }
    }
    store.updateTest(test.id, {});
    clearInterval(ticker);
    await load(i);
  }

  async function finish() {
    bankTime();
    if (!tutor) {
      const cur = qid();
      const choice = test.picks[cur];
      if (choice && !test.locked[cur]) {
        test.locked[cur] = true;
        store.recordAnswer(cur, choice, choice === q?.key, test.spent[cur] || 0, test.id);
      }
    }
    clearInterval(ticker);
    store.finishTest(test.id);
    go(`/results/${test.id}`);
  }

  /* ── footer ─────────────────────────────────────────────────────────── */

  function drawFoot() {
    const locked = !!test.locked[q?.id];
    const last = idx === test.qids.length - 1;
    const canSubmit = tutor && !locked;

    // One primary action in the centre; at most one secondary on the right.
    const primary = canSubmit
      ? h('button.btn.btn--primary.btn--lg', {
        disabled: !test.picks[q.id], onclick: () => submit(),
      }, 'Submit answer')
      : last
        ? h('button.btn.btn--primary.btn--lg', { onclick: () => confirmFinish() }, 'Finish test')
        : h('button.btn.btn--primary.btn--lg', { onclick: () => goTo(idx + 1) }, 'Next item →');

    const secondary = canSubmit
      ? (last
        ? h('button.btn', { onclick: () => confirmFinish() }, 'Finish test')
        : h('button.btn', { onclick: () => goTo(idx + 1) }, 'Skip →'))
      : null;

    fill(footHost,
      h('button.btn', { disabled: idx === 0, onclick: () => goTo(idx - 1) }, '← Previous'),
      h('div.grow', primary),
      // Keeps the primary action optically centred whether or not it is shown.
      secondary || h('span', { style: { minWidth: '84px' } }),
    );
  }

  async function confirmFinish() {
    const unanswered = test.qids.filter((x) => !test.picks[x]).length;
    const ok = await confirm({
      title: 'Finish this test?',
      desc: unanswered
        ? `${unanswered} item${unanswered === 1 ? '' : 's'} will be scored as omitted.`
        : 'Your results will be scored and saved.',
      ok: 'Finish test',
    });
    if (ok) finish();
  }

  /* ── rail ───────────────────────────────────────────────────────────── */

  function drawRail() {
    if (!q) return;
    const hls = store.highlightsFor(q.id);
    const notes = store.notesFor(q.id);

    fill(railHost,
      h('div.rail-head',
        h('h3', 'This item'),
        h('div.push.row', { style: { gap: '6px' } },
          h('button.btn.btn--sm', {
            onclick: () => {
              const note = noteForQuestion(q.id);
              go(`/notebook/${note.id}`);
            },
          }, 'Open notes'),
          h('button.btn.btn--sm.btn--icon', {
            title: 'Hide this panel', 'aria-label': 'Hide panel',
            onclick: () => { showRail = false; store.setPref('showRail', false); applyRail(); },
          }, '✕'))),

      h('div.rail-body',
        h('div.label', `Highlights · ${hls.length}`),
        hls.length
          ? hls.map((hl) => {
            const el2 = mainHost.querySelector(`mark.hl[data-id="${hl.id}"]`);
            const text = el2?.textContent || '(passage no longer visible)';
            return h('div.hl-item',
              h('div.row', { style: { alignItems: 'stretch', gap: '9px' } },
                h('div.hl-item__bar', { style: { background: `var(--hl-${hl.c})` } }),
                h('div.hl-item__q.grow', text)),
              h('div.hl-item__act',
                h('button.btn.btn--sm', {
                  onclick: () => {
                    clipText({ qid: q.id, text, source: 'Highlight', color: hl.c });
                    store.updateHighlight(q.id, hl.id, { note: store.notesFor(q.id)[0]?.id });
                    drawRail();
                  },
                }, 'To notebook'),
                h('button.btn.btn--sm.btn--ghost', {
                  onclick: () => {
                    store.removeHighlight(q.id, hl.id);
                    drawItem();
                    drawRail();
                  },
                }, 'Remove')));
          })
          : h('p.xs.muted', 'Select any passage in the item to highlight it. Highlights are saved with the question.'),

        h('div.label', { style: { marginTop: '8px' } }, `Notes · ${notes.length}`),
        notes.length
          ? notes.map((nt) => h('button.note-mini', {
            onclick: () => go(`/notebook/${nt.id}`),
          },
            h('b', nt.title || 'Untitled note'),
            h('p', nt.clips.length
              ? `${nt.clips.length} clip${nt.clips.length === 1 ? '' : 's'}`
              : (nt.body || 'Empty note').slice(0, 90))))
          : h('p.xs.muted', 'No notes on this item yet.'),

        h('button.btn.btn--block', {
          onclick: () => {
            const note = noteForQuestion(q.id);
            go(`/notebook/${note.id}`);
          },
        }, 'Take a note'),
      ));
  }

  /* ── reference values ───────────────────────────────────────────────── */

  async function showReference() {
    let ref;
    try { ref = await loadReference(); }
    catch { toast('Reference values could not be loaded.'); return; }

    modal({
      title: ref.title, desc: ref.note, wide: true,
      body: h('div.stack-16',
        ref.groups.map((g) => h('div.xtab',
          h('div.xtab__head', h('div.xtab__title', g.name)),
          h('table', h('tbody', g.rows.map((r) => h('tr', h('td', r[0]), h('td', r[1])))))))),
      actions: (close) => [h('button.btn.btn--primary', { onclick: close }, 'Done')],
    });
  }

  /* ── keyboard ───────────────────────────────────────────────────────── */

  const onKey = (ev) => {
    const el2 = document.activeElement;
    if (el2 && (el2.tagName === 'INPUT' || el2.tagName === 'TEXTAREA' || el2.isContentEditable)) return;
    if (ev.metaKey || ev.ctrlKey) {
      if (ev.key === '\\') { ev.preventDefault(); showRail = !showRail; store.setPref('showRail', showRail); applyRail(); }
      return;
    }
    if (!q) return;

    const letter = ev.key.toUpperCase();
    if (LETTERS.includes(letter)) {
      ev.preventDefault();
      if (!(tutor && test.locked[q.id])) pick(letter);
      return;
    }
    if (/^[1-5]$/.test(ev.key)) {
      ev.preventDefault();
      const k = LETTERS[Number(ev.key) - 1];
      if (k && !(tutor && test.locked[q.id])) pick(k);
      return;
    }
    switch (ev.key) {
      case 'Enter':
        ev.preventDefault();
        if (tutor && !test.locked[q.id]) submit();
        else if (idx < test.qids.length - 1) goTo(idx + 1);
        else confirmFinish();
        break;
      case 'ArrowRight': ev.preventDefault(); goTo(idx + 1); break;
      case 'ArrowLeft': ev.preventDefault(); goTo(idx - 1); break;
      case 'm': case 'M':
        ev.preventDefault(); store.toggleMark(q.id); drawItem(); drawBar(); break;
      case 'h': case 'H':
        if (highlightSelection('yellow')) { ev.preventDefault(); drawRail(); }
        break;
      case 'l': case 'L': ev.preventDefault(); showReference(); break;
      default: break;
    }
  };
  document.addEventListener('keydown', onKey);

  /* ── go ─────────────────────────────────────────────────────────────── */

  await load(idx);

  return {
    title: test.name,
    subtitle: `${tutor ? 'Tutor mode' : 'Timed exam'}${test.timerSecs ? ` · ${secs(test.timerSecs)} per item` : ' · untimed'}`,
    actions: [
      h('button.btn.btn--sm', { onclick: showReference, title: 'Reference intervals (L)' }, 'Lab values'),
      h('button.btn.btn--sm', {
        onclick: () => { showRail = !showRail; store.setPref('showRail', showRail); applyRail(); },
        title: 'Toggle the side panel (⌘\\)',
      }, 'Panel'),
      h('button.btn.btn--sm', {
        onclick: () => { bankTime(); store.updateTest(test.id, {}); toast('Test suspended — resume it from the overview.'); go('/'); },
      }, 'Suspend'),
      h('button.btn.btn--sm.btn--danger', { onclick: () => confirmFinish() }, 'End test'),
    ],
    el,
    fixed: true,
    destroy() {
      clearInterval(ticker);
      document.removeEventListener('keydown', onKey);
      detachHl?.();
      bankTime();
      store.updateTest(test.id, {});
      store.flush();
    },
  };
}
