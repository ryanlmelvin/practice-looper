import { validateSnapshot } from './state.js';

export function createShareLink(value, baseURL) {
  const clean = validateSnapshot(value);
  if (!clean) throw new Error('Set a valid A–B passage before sharing a loop.');
  const url = new URL(baseURL);
  url.search = '';
  url.hash = 'share=1.' + btoa(JSON.stringify({ ...clean, position:clean.a }))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return url.href;
}

export function readShareLink(hash) {
  if (!hash.startsWith('#share=')) return null;
  try {
    if (hash.length > 2000 || !/^#share=1\.[A-Za-z0-9_-]+$/.test(hash)) throw new Error();
    const clean = validateSnapshot(JSON.parse(atob(hash.slice(9).replaceAll('-', '+').replaceAll('_', '/'))));
    if (!clean) throw new Error();
    return { ...clean, position:clean.a };
  } catch { throw new Error('This loop link is invalid or incomplete.'); }
}
