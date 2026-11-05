const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const EMBED_HOSTS = new Set(['youtube-nocookie.com', 'www.youtube-nocookie.com']);

/** Return only a video identifier. Unrelated hosts and playlist-only URLs are rejected. */
export function parseYouTubeURL(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (VIDEO_ID.test(value)) return value;
  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  let id = null;
  if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') {
    if (segments.length === 1) id = segments[0];
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (segments.length === 2 && ['shorts', 'embed', 'live', 'v'].includes(segments[0])) id = segments[1];
  } else if (EMBED_HOSTS.has(url.hostname) && segments.length === 2 && segments[0] === 'embed') {
    id = segments[1];
  }
  return VIDEO_ID.test(id || '') ? id : null;
}

const STATES = { '-1': 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };
const ERRORS = {
  2: 'This YouTube link is invalid. Check the link and load it again.',
  5: 'YouTube could not play this video in this browser. Try another video or browser.',
  100: 'This video is unavailable or private. Try another YouTube link.',
  101: 'The owner does not allow this video to play here. Try another YouTube link.',
  150: 'The owner does not allow this video to play here. Try another YouTube link.',
  153: 'YouTube could not identify this app. Open its normal website address and try again; a referrer-blocking browser setting may also prevent playback.',
};

let apiPromise;

function loadAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  const pending = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    let settled = false;
    let timeout;
    function cleanup() {
      clearTimeout(timeout);
      script.onerror = null;
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previousReady;
    }
    function fail() {
      if (settled) return;
      settled = true;
      cleanup();
      script.remove();
      reject(new Error('YouTube did not load. Check your connection, then try Load again.'));
    }
    function ready() {
      if (settled) return;
      if (!window.YT?.Player) return fail();
      settled = true;
      cleanup();
      resolve(window.YT);
      if (typeof previousReady === 'function') previousReady();
    }
    window.onYouTubeIframeAPIReady = ready;
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = fail;
    timeout = setTimeout(fail, 15000);
    document.head.append(script);
  });
  apiPromise = pending;
  pending.catch(() => { if (apiPromise === pending) apiPromise = undefined; });
  return pending;
}

function time(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Uses only the visible official iframe player. Loading/cueing never requests autoplay. */
export async function createYouTubePlayer({
  element, videoId, startSeconds = 0,
  onStateChange = () => {}, onError = () => {},
  onRatesChange = () => {}, onRateChange = () => {},
}) {
  if (!VIDEO_ID.test(videoId)) throw new Error('Enter a valid YouTube video link.');
  const YT = await loadAPI();
  return new Promise((resolve, reject) => {
    let player;
    let destroyed = false;
    let ready = false;
    let currentVideoId = videoId;
    let lastRates = '';
    const timeout = setTimeout(() => {
      if (ready || destroyed) return;
      adapter.destroy();
      reject(new Error('The YouTube player did not respond. Check your connection and try Load again.'));
    }, 20000);
    const read = (method, fallback) => {
      if (destroyed || !player || typeof player[method] !== 'function') return fallback;
      try { return player[method](); } catch { return fallback; }
    };
    function reportRates() {
      if (destroyed) return;
      const rates = adapter.getRates();
      const key = rates.join(',');
      if (key !== lastRates) {
        lastRates = key;
        onRatesChange(rates);
      }
    }
    const adapter = {
      load(id, position = 0) {
        if (destroyed) return;
        if (!VIDEO_ID.test(id)) throw new Error('Enter a valid YouTube video link.');
        currentVideoId = id;
        lastRates = '';
        player.cueVideoById({ videoId: id, startSeconds: time(position) });
      },
      play() { if (!destroyed) player.playVideo(); },
      pause() { if (!destroyed) player.pauseVideo(); },
      seek(seconds) { if (!destroyed && Number.isFinite(seconds)) player.seekTo(Math.max(0, seconds), true); },
      getCurrentTime() { return time(read('getCurrentTime', 0)); },
      getDuration() { return time(read('getDuration', 0)); },
      getState() { return STATES[read('getPlayerState', -1)] || 'unstarted'; },
      getVideoId() { return currentVideoId; },
      getRates() {
        const raw = read('getAvailablePlaybackRates', [1]);
        const rates = Array.isArray(raw) ? raw.filter(rate => Number.isFinite(rate) && rate > 0) : [];
        return rates.length ? [...new Set(rates)].sort((a, b) => a - b) : [1];
      },
      getRate() {
        const rate = read('getPlaybackRate', 1);
        return Number.isFinite(rate) && rate > 0 ? rate : 1;
      },
      setRate(rate) {
        if (destroyed || !adapter.getRates().includes(rate)) return false;
        player.setPlaybackRate(rate);
        return true; // A request only; onRateChange reports the accepted speed.
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        clearTimeout(timeout);
        try { player?.destroy(); } catch { /* A failed iframe can already be gone. */ }
      },
    };
    try {
      player = new YT.Player(element, {
        width: '100%', height: '100%', videoId,
        playerVars: {
          autoplay: 0, controls: 1, playsinline: 1,
          origin: window.location.origin,
          start: Math.floor(time(startSeconds)),
        },
        events: {
          onReady(event) {
            if (destroyed) return;
            player = event.target;
            ready = true;
            clearTimeout(timeout);
            const iframe = player.getIframe?.();
            if (iframe) {
              iframe.title = 'YouTube video player';
              iframe.referrerPolicy = 'strict-origin-when-cross-origin';
            }
            // cueVideoById accepts fractional seconds, unlike the start URL parameter.
            if (startSeconds > 0) player.cueVideoById({ videoId, startSeconds: time(startSeconds) });
            resolve(adapter);
            reportRates();
            onRateChange(adapter.getRate());
            onStateChange(adapter.getState());
          },
          onStateChange(event) {
            if (destroyed) return;
            reportRates();
            onStateChange(STATES[event.data] || 'unstarted');
          },
          onPlaybackRateChange(event) {
            if (destroyed) return;
            reportRates();
            if (Number.isFinite(event.data) && event.data > 0) onRateChange(event.data);
          },
          onApiChange() { if (!destroyed) reportRates(); },
          onError(event) {
            if (destroyed) return;
            const message = ERRORS[event.data] || 'YouTube could not play this video. Try loading it again or use another link.';
            onError(message);
            if (!ready) {
              adapter.destroy();
              reject(new Error(message));
            }
          },
          onAutoplayBlocked() {
            if (!destroyed) onError('Your browser blocked playback. Press Play inside the YouTube player.');
          },
        },
      });
    } catch (error) {
      adapter.destroy();
      reject(error);
    }
  });
}
