import { validateSnapshot } from './state.js';

const MAX_HISTORY = 100;
const MAX_TITLE = 300;

export function historyKey(path) {
  return `practice-looper:${path}:history:v1`;
}

export function segmentKey(snapshot) {
  return `${snapshot.videoId}:${snapshot.a}:${snapshot.b}`;
}

function validateEntry(value) {
  const snapshot = validateSnapshot(value);
  if (!snapshot || typeof value.title !== 'string' ||
      !Number.isFinite(value.practicedAt) || value.practicedAt < 0) return null;
  return { ...snapshot, title: value.title.trim().slice(0, MAX_TITLE), practicedAt: value.practicedAt };
}

function recentEntries(entries) {
  const seen = new Set();
  return entries.sort((a, b) => b.practicedAt - a.practicedAt).filter(entry => {
    const key = segmentKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_HISTORY);
}

export function createHistoryStore(storage, path) {
  const key = historyKey(path);

  function read() {
    const raw = storage.getItem(key);
    if (raw === null) return [];
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      throw new Error('Saved practice history is invalid. Use Clear saved browser data to clear it.');
    }
    if (!Array.isArray(parsed)) {
      throw new Error('Saved practice history is invalid. Use Clear saved browser data to clear it.');
    }
    return recentEntries(parsed.map(validateEntry).filter(Boolean));
  }

  return {
    read,
    record(snapshot, { title = '', practicedAt = Date.now() } = {}) {
      let entry = validateEntry({ ...snapshot, title, practicedAt });
      if (!entry) throw new Error('Set a valid A–B passage before saving practice history.');
      // Read at write time so another window's recently practiced segments survive.
      const previous = read();
      const id = segmentKey(entry);
      const existing = previous.find(value => segmentKey(value) === id);
      // A paused window can save position after another window has practiced
      // this same segment. Preserve the newer practice and its settings.
      if (existing && existing.practicedAt > entry.practicedAt) {
        entry = { ...existing, title: existing.title || entry.title };
      } else if (!entry.title && existing) entry.title = existing.title;
      const entries = recentEntries([entry, ...previous.filter(value => segmentKey(value) !== id)]);
      storage.setItem(key, JSON.stringify(entries));
      return entries;
    },
    remove(id) {
      const entries = read().filter(entry => segmentKey(entry) !== id);
      storage.setItem(key, JSON.stringify(entries));
      return entries;
    },
    clear() { storage.removeItem(key); },
  };
}
