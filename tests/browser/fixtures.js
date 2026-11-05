export const VIDEO_ID = 'M7lc1UVf-VE';

// The network boundary is replaced for deterministic control tests. Production
// code still uses the public iframe API, with no test-only hooks or alternate engine.
export const fakeYouTubeAPI = `(() => {
  class Player {
    constructor(element, options) {
      this.options = options;
      this.videoId = options.videoId;
      this.currentTime = options.playerVars.start || 0;
      this.duration = 120;
      this.state = 5;
      this.rate = 1;
      this.playCalls = 0;
      this.seekCalls = [];
      this.cueCalls = [];
      this.rejectRate = false;
      this.iframe = document.createElement('iframe');
      this.iframe.title = 'YouTube video player';
      this.iframe.srcdoc = '<html><body style="margin:0;background:#18231e;color:white;font:16px system-ui;display:grid;place-content:center;height:100vh">YouTube test player</body></html>';
      this.iframe.width = '100%';
      this.iframe.height = '100%';
      (typeof element === 'string' ? document.getElementById(element) : element).replaceWith(this.iframe);
      window.__fakeYT = this;
      this.lastTick = performance.now();
      this.timer = setInterval(() => {
        const now = performance.now();
        if (this.state === 1) this.currentTime += (now - this.lastTick) / 1000 * this.rate;
        this.lastTick = now;
        if (this.currentTime >= this.duration && this.state === 1) {
          this.currentTime = this.duration;
          this.emitState(0);
        }
      }, 20);
      setTimeout(() => {
        options.events.onReady({ target: this });
        if (this.videoId === 'blocked0001') setTimeout(() => options.events.onError({ data: 101 }), 20);
      }, 20);
    }
    emitState(state) {
      this.state = state;
      this.lastTick = performance.now();
      this.options.events.onStateChange({ data: state, target: this });
    }
    getIframe() { return this.iframe; }
    getCurrentTime() { return this.currentTime; }
    getDuration() { return this.duration; }
    getPlayerState() { return this.state; }
    getPlaybackRate() { return this.rate; }
    getAvailablePlaybackRates() { return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]; }
    setPlaybackRate(rate) {
      if (this.rejectRate) return;
      setTimeout(() => {
        this.rate = rate;
        this.options.events.onPlaybackRateChange({ data: rate, target: this });
      }, 20);
    }
    playVideo() { this.playCalls++; this.emitState(1); }
    pauseVideo() { this.emitState(2); }
    cueVideoById(value) {
      this.cueCalls.push(value);
      this.videoId = value.videoId;
      this.currentTime = value.startSeconds || 0;
      this.rate = 1;
      this.emitState(5);
    }
    seekTo(time) {
      this.seekCalls.push(time);
      this.currentTime = time;
      if (this.state !== 2) this.emitState(1);
    }
    externalSeek(time) {
      this.currentTime = time;
      this.emitState(3);
      setTimeout(() => this.emitState(1), 20);
    }
    destroy() { clearInterval(this.timer); this.iframe.remove(); }
  }
  window.YT = { Player };
  window.onYouTubeIframeAPIReady?.();
})();`;

export async function mockYouTube(page) {
  let requests = 0;
  await page.route('https://www.youtube.com/iframe_api', route => {
    requests++;
    return route.fulfill({ contentType: 'text/javascript', body: fakeYouTubeAPI });
  });
  return { get requests() { return requests; } };
}

export async function loadVideo(page, id = VIDEO_ID) {
  await page.locator('#video-url').fill(`https://youtu.be/${id}`);
  if (await page.locator('#consent-checkbox').isVisible()) await page.locator('#consent-checkbox').check();
  await page.locator('#load-button').click();
  await page.locator('#playback-controls').waitFor({ state: 'visible' });
}

export async function setPoint(page, id, value) {
  await page.locator(`#point-${id}`).fill(value);
  await page.locator(`#point-${id}`).press('Tab');
}

export async function seek(page, value) {
  await page.locator('#seek').evaluate((element, position) => {
    element.value = String(position);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
