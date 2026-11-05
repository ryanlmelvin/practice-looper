export const MIN_LOOP = 0.5;

export function parseTime(value) {
  const text = String(value).trim();
  if (!/^(?:\d+:)?\d+(?:\.\d+)?$/.test(text)) return NaN;
  const parts = text.split(':').map(Number);
  if (parts.length === 2 && parts[1] >= 60) return NaN;
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
}

export function formatTime(seconds, precise = false) {
  if (!Number.isFinite(seconds) || seconds < 0) return precise ? '0:00.0' : '0:00';
  const rounded = precise ? Math.round(seconds * 10) / 10 : Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded - minutes * 60;
  return `${minutes}:${precise ? remainder.toFixed(1).padStart(4, '0') : String(remainder).padStart(2, '0')}`;
}

export function validateSnapshot(value) {
  if (!value || value.schema !== 1 || value.source !== 'youtube' || typeof value.videoId !== 'string' || !/^[\w-]{11}$/.test(value.videoId)) return null;
  const finite = (n, max) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;
  if (!finite(value.a, 604800) || !finite(value.b, 604800) || value.b - value.a < MIN_LOOP) return null;
  if (!finite(value.position, 604800) || !finite(value.rate, 16) || value.rate === 0 || typeof value.repeat !== 'boolean') return null;
  return { schema: 1, source: 'youtube', videoId: value.videoId, a: value.a, b: value.b, position: value.position, rate: value.rate, repeat: value.repeat };
}

export function restoreForDuration(snapshot, duration) {
  const clean = validateSnapshot(snapshot);
  if (!clean || !Number.isFinite(duration) || duration <= 0) return null;
  if (clean.b > duration || clean.a >= duration) return null;
  return { ...clean, position: Math.min(clean.position, duration) };
}

export function createSettingsStore(storage, path) {
  const key = `practice-looper:${path}:settings:v1`;
  return {
    read() {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const parsed = validateSnapshot(JSON.parse(raw));
      if (!parsed) throw new Error('Saved settings are invalid. Load a video to start again.');
      return parsed;
    },
    write(snapshot) {
      const clean = validateSnapshot(snapshot);
      if (!clean) throw new Error('Set a valid A–B passage before saving.');
      storage.setItem(key, JSON.stringify(clean));
      return clean;
    }
  };
}
