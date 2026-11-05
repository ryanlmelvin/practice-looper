export const MIN_LOOP_SECONDS = 0.5;
const SEEK_TIMEOUT_MS = 10_000;
const JUMP_TOLERANCE_SECONDS = 0.8;

export function validateRange(a, b, duration) {
  return Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(duration)
    && a >= 0 && duration > 0 && b <= duration && b - a >= MIN_LOOP_SECONDS;
}

/** A polling controller for the documented player API. It never owns a timer. */
export class LoopController {
  constructor({ player, onRepeatChange = () => {}, onError = () => {}, now = () => performance.now() }) {
    this.player = player;
    this.onRepeatChange = onRepeatChange;
    this.onError = onError;
    this.now = now;
    this.a = null;
    this.b = null;
    this.enabled = false;
    this.pending = null;
    this.previous = null;
    this.wasPlaying = false;
    this.needsStart = false;
    this.destroyed = false;
  }

  setRange(a, b) {
    this.a = a;
    this.b = b;
    const valid = validateRange(a, b, this.player.getDuration());
    if (!valid && this.enabled) this.disable('Set B at least 0.5 seconds after A, within this video.');
    if (valid && this.enabled) {
      this.needsStart = this.outside(this.player.getCurrentTime());
    }
    return valid;
  }

  setEnabled(enabled) {
    if (this.destroyed) return false;
    if (!enabled) {
      this.disable();
      return true;
    }
    if (!validateRange(this.a, this.b, this.player.getDuration())) {
      this.onError('Set A and B at least 0.5 seconds apart, within this video.');
      return false;
    }
    if (this.enabled) return true;
    this.enabled = true;
    this.previous = null;
    this.wasPlaying = false;
    this.needsStart = this.outside(this.player.getCurrentTime());
    this.onRepeatChange(true);
    const state = this.player.getState();
    // YouTube can start playback when seeking a cued or ended video.
    if (this.needsStart && (state === 'playing' || state === 'paused')) this.seek(this.a, 'loop');
    return this.enabled;
  }

  outside(time) {
    return time < this.a || time >= this.b;
  }

  disable(message) {
    const changed = this.enabled;
    this.enabled = false;
    this.pending = null;
    this.needsStart = false;
    this.previous = null;
    this.wasPlaying = false;
    if (changed) this.onRepeatChange(false, message);
  }

  seek(target, kind, restart = false) {
    if (this.pending || this.destroyed) return false;
    this.pending = { target, kind, startedAt: this.now() };
    this.needsStart = false;
    this.previous = null;
    try {
      this.player.seek(target);
      if (restart) this.player.play();
      return true;
    } catch {
      this.disable();
      this.onError('YouTube could not seek. Try playing the video, then turn Repeat on again.');
      return false;
    }
  }

  manualSeek(seconds) {
    if (this.destroyed || !Number.isFinite(seconds)) return false;
    const duration = this.player.getDuration();
    if (!Number.isFinite(duration) || duration <= 0) return false;
    const target = Math.max(0, Math.min(seconds, duration));
    // A deliberate user seek replaces an in-flight loop seek.
    this.pending = null;
    this.previous = null;
    if (this.enabled && this.outside(target)) this.disable('Repeat off: playback moved outside A–B.');
    return this.seek(target, 'manual');
  }

  tick() {
    if (this.destroyed) return;
    const time = this.player.getCurrentTime();
    const state = this.player.getState();
    const duration = this.player.getDuration();
    const rate = this.player.getRate() || 1;
    const wall = this.now();
    if (!Number.isFinite(time) || !Number.isFinite(duration)) return;

    if (this.enabled && !validateRange(this.a, this.b, duration)) {
      this.disable('Repeat off: the saved points do not fit this video.');
      return;
    }

    if (state === 'paused' || state === 'cued' || state === 'unstarted') this.wasPlaying = false;

    if (this.pending) {
      const elapsed = (wall - this.pending.startedAt) / 1000;
      const tolerance = this.enabled ? Math.min(0.35, (this.b - this.a) / 3) : 0.35;
      // A seek may complete between polls, after playback has already advanced.
      const upper = this.pending.target + tolerance + (state === 'playing' ? Math.min(elapsed, 0.4) * rate : 0);
      if (time >= this.pending.target - tolerance && time <= upper) {
        this.pending = null;
        this.previous = { time, state, rate, wall };
        if (state === 'playing') this.wasPlaying = true;
        return;
      }
      if (wall - this.pending.startedAt >= SEEK_TIMEOUT_MS) {
        this.disable();
        this.onError('The seek did not finish. Wait for YouTube to play, then try Repeat again.');
      }
      return;
    }

    if (!this.enabled) {
      this.previous = { time, state, rate, wall };
      this.wasPlaying = state === 'playing';
      return;
    }

    if (this.needsStart) {
      if (state === 'playing') this.seek(this.a, 'loop');
      return;
    }

    const last = this.previous;
    if (last) {
      const elapsed = Math.max(0, (wall - last.wall) / 1000);
      const delta = time - last.time;
      const expected = elapsed * Math.max(rate, last.rate);
      const jumped = delta < -JUMP_TOLERANCE_SECONDS || delta > expected + JUMP_TOLERANCE_SECONDS;
      if (jumped && this.outside(time)) {
        this.disable('Repeat off: playback moved outside A–B.');
        return;
      }
    }

    if (state === 'playing') {
      this.wasPlaying = true;
      if (time >= this.b) {
        this.seek(this.a, 'loop');
        return;
      }
    } else if (state === 'ended' && this.wasPlaying && last && time >= this.b - 0.15) {
      // Only a natural end after active playback may restart sound.
      this.seek(this.a, 'loop', true);
      return;
    }
    this.previous = { time, state, rate, wall };
  }

  reset() {
    this.disable();
    this.a = null;
    this.b = null;
  }

  destroy() {
    this.reset();
    this.destroyed = true;
  }
}
