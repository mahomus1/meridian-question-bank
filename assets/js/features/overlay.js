/* Toasts, modals, and the small prompts they compose into. */

import { h, fill, trap, $ } from '../core/dom.js';

/* ── toasts ───────────────────────────────────────────────────────────── */

const host = () => $('#toasts');

export function toast(message, { action, onAction, ms = 3400 } = {}) {
  const el = h('div.toast', h('span', message));
  if (action) {
    el.appendChild(h('button', {
      onclick: () => { dismiss(); onAction?.(); },
    }, action));
  }
  host().appendChild(el);

  let timer = setTimeout(dismiss, ms);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 1400); });

  function dismiss() {
    clearTimeout(timer);
    if (!el.isConnected) return;
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 220);
  }
  return dismiss;
}

/* ── modal ────────────────────────────────────────────────────────────── */

let closeCurrent = null;

/**
 * @param {{title:string, desc?:string, body?:Node, actions:(close:Function)=>Node[], wide?:boolean}} opts
 */
export function modal({ title, desc, body, actions, wide = false, onOpen }) {
  closeCurrent?.();
  const root = $('#modal');
  const prevFocus = document.activeElement;

  const close = () => {
    untrap?.();
    root.hidden = true;
    root.replaceChildren();
    closeCurrent = null;
    document.removeEventListener('keydown', onEsc, true);
    if (prevFocus?.isConnected) prevFocus.focus();
  };
  closeCurrent = close;

  const onEsc = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };

  const box = h(`div.modal__box${wide ? '.modal__box--wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal__head', h('h2', title), desc && h('p', desc)),
    body && h('div.modal__body', body),
    h('div.modal__foot', actions ? actions(close) : h('button.btn', { onclick: close }, 'Close')),
  );

  fill(root, box);
  root.hidden = false;
  root.onclick = (ev) => { if (ev.target === root) close(); };
  document.addEventListener('keydown', onEsc, true);
  const untrap = trap(box, close);

  const first = box.querySelector('input, textarea, button.btn--primary, button');
  first?.focus();
  onOpen?.(box, close);
  return close;
}

export function confirm({ title, desc, ok = 'Confirm', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    modal({
      title, desc,
      actions: (close) => [
        h('button.btn', { onclick: () => { close(); resolve(false); } }, cancel),
        h(`button.btn.${danger ? 'btn--danger' : 'btn--primary'}`, {
          onclick: () => { close(); resolve(true); },
        }, ok),
      ],
    });
  });
}

export function prompt({ title, desc, label, value = '', placeholder = '', ok = 'Save', multiline = false }) {
  return new Promise((resolve) => {
    let input;
    const field = h('label.field',
      label && h('span.label', label),
      input = multiline
        ? h('textarea.textarea', { rows: 5, placeholder, value })
        : h('input.input', { type: 'text', placeholder, value }));

    modal({
      title, desc, body: field,
      actions: (close) => [
        h('button.btn', { onclick: () => { close(); resolve(null); } }, 'Cancel'),
        h('button.btn.btn--primary', {
          onclick: () => { const v = input.value.trim(); close(); resolve(v || null); },
        }, ok),
      ],
      onOpen: () => {
        input.focus();
        input.select?.();
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' && (!multiline || ev.metaKey || ev.ctrlKey)) {
            ev.preventDefault();
            const v = input.value.trim();
            closeCurrent?.();
            resolve(v || null);
          }
        });
      },
    });
  });
}

export const closeModal = () => closeCurrent?.();
