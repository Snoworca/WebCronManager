import type { Me } from './types.ts';

/** 해시 라우팅: #/jobs, #/jobs/12, #/runs?run=3 */
export const route = $state({ path: '/jobs', query: new URLSearchParams() });

function parse() {
  const h = decodeURIComponent(location.hash.replace(/^#/, '')) || '/jobs';
  const [p, q] = h.split('?');
  route.path = p.startsWith('/') ? p : `/${p}`;
  route.query = new URLSearchParams(q ?? '');
}
window.addEventListener('hashchange', parse);
parse();

export function go(path: string) {
  location.hash = path;
}

export const session = $state({ me: null as Me | null, checked: false });

export const toast = $state({ text: '' });
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(text: string) {
  toast.text = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.text = ''), 4000);
}
