/* Hash router.
   Routes declare a pattern; the matched view returns a descriptor the shell
   uses to paint the topbar and body. Views may expose destroy() for cleanup. */

const routes = [];
let current = null;
let onRender = () => {};

export function route(pattern, load) {
  const keys = [];
  const rx = new RegExp('^' + pattern
    .replace(/\/:([^/]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; })
    .replace(/\/$/, '') + '/?$');
  routes.push({ rx, keys, load, pattern });
}

export function parse(hash) {
  const raw = (hash || location.hash || '#/').replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return { path: path || '/', query };
}

export function go(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (location.hash === target) { render(); return; }
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
}

export const here = () => parse().path;

export function match(path) {
  for (const r of routes) {
    const m = r.rx.exec(path);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { ...r, params };
  }
  return null;
}

export async function render() {
  const { path, query } = parse();
  const hit = match(path);

  if (current?.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
  current = null;

  if (!hit) { onRender(null, { path }); return; }

  try {
    const view = await hit.load({ ...hit.params, query, path });
    current = view;
    onRender(view, { path, params: hit.params });
  } catch (err) {
    console.error('Meridian: view failed to render.', err);
    onRender({ error: err }, { path });
  }
}

export function start(handler) {
  onRender = handler;
  addEventListener('hashchange', render);
  render();
}

