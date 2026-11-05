import { createYouTubePlayer, parseYouTubeURL, fetchYouTubeTitle } from './youtube.js';
import { LoopController, validateRange } from './loop-controller.js';
import { createSettingsStore, parseTime, formatTime, validateSnapshot, restoreForDuration } from './state.js';
import { createHistoryStore, historyKey, segmentKey } from './history.js';
import { createShareLink, readShareLink } from './share-link.js';
import { setupPWA } from './pwa.js';

const $ = id => document.getElementById(id);
const scopePath = new URL('.', location.href).pathname;
const consentKey = `practice-looper:${scopePath}:youtube-consent`;
const settingsKey = `practice-looper:${scopePath}:settings:v1`;
let store;
let sessionStore;
let saved = null;
let player = null;
let loop = null;
let videoId = null;
let generation = 0;
let duration = 0;
let initialized = false;
let requestedRate = 1;
let statusTimer;
let rateTimer;
let saveTimer;
let lastSavedPosition = 0;
let scrubbing = false;
let storageErrorShown = false;
let pendingRestore = null;
let forgotten = false;
let pendingRate = null;
let initialDuration = 0;
let changingDuration = false;
let historyStore;
let history = [];
let historyRenderKey = '';
let historyErrorShown = false;
let practicedSegment = null;
let suppressedSegment = null;
let playbackActive = false;
let videoTitle = '';
let titleController;

function status(message = '', isError = false, transient = false, blockerHelp = false) {
  clearTimeout(statusTimer);
  $('blocker-help').hidden = !blockerHelp;
  if (!blockerHelp) $('blocker-help').open = false;
  $('status').textContent = message;
  $('status').hidden = !message;
  $('status').classList.toggle('error', isError);
  if (transient) statusTimer = setTimeout(() => status(), 5000);
}

try {
  store = createSettingsStore(localStorage, scopePath);
  sessionStore = createSettingsStore(sessionStorage, scopePath);
  saved = sessionStore.read() || store.read();
  if (localStorage.getItem(consentKey) === 'yes') acceptConsent(false);
} catch {
  status('The saved loop could not be read. You can still practice; export your history to keep a copy.', true);
}
if (saved) $('video-url').value = `https://www.youtube.com/watch?v=${saved.videoId}`;
try {
  historyStore = createHistoryStore(localStorage, scopePath);
  history = historyStore.read();
  renderHistory();
} catch { status('History could not be read. You can still practice.', true); }

function renderHistory() {
  $('history').hidden = history.length === 0;
  // Position saves must not replace focused buttons or reset the scroll position.
  const renderKey = JSON.stringify(history.map(entry => [segmentKey(entry), entry.title, entry.rate]));
  if (renderKey !== historyRenderKey) {
    const focused = document.activeElement;
    const focusedRow = focused?.closest('#history-list li');
    const focusedKey = focusedRow?.dataset.segmentKey;
    const wasDelete = focused?.classList.contains('history-delete');
    const oldIndex = [...$('history-list').children].indexOf(focusedRow);
    const scrollTop = $('history-list').scrollTop;
    $('history-list').replaceChildren(...history.map(entry => {
      const row = document.createElement('li');
      row.dataset.segmentKey = segmentKey(entry);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-entry';
      const title = document.createElement('span');
      title.className = 'history-title';
      title.textContent = entry.title || `YouTube · ${entry.videoId}`;
      const range = `${formatTime(entry.a, true)}–${formatTime(entry.b, true)}`;
      const details = document.createElement('span');
      details.className = 'history-range';
      details.textContent = `${range} · ${entry.rate}×`;
      button.append(title, details);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'history-delete';
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete ${title.textContent}, ${range}`);
      const share = document.createElement('button');
      share.type = 'button';
      share.className = 'history-share';
      share.textContent = 'Share';
      share.setAttribute('aria-label', `Share ${title.textContent}, ${range}`);
      row.append(button, share, remove);
      return row;
    }));
    historyRenderKey = renderKey;
    $('history-list').scrollTop = scrollTop;
    if (focusedKey) {
      const rows = [...$('history-list').children];
      const next = rows.find(row => row.dataset.segmentKey === focusedKey) || rows[Math.min(oldIndex, rows.length - 1)];
      (next?.querySelector(wasDelete ? '.history-delete' : '.history-entry') || $('video-url')).focus({ preventScroll:true });
    }
  }
  for (const button of document.querySelectorAll('.history-entry')) button.disabled = $('load-button').disabled;
}

function notePractice(resumed = false) {
  if (forgotten || !initialized || changingDuration) return;
  const value = snapshot();
  if (!validateSnapshot(value)) return;
  const key = segmentKey(value);
  if (key === suppressedSegment && !resumed) return;
  if (resumed || practicedSegment?.key !== key) {
    practicedSegment = { key, practicedAt:Date.now(), saved:false };
    suppressedSegment = null;
  }
}

function persistHistory(value) {
  if (!player || !initialized || changingDuration) return true;
  if (player.getState() === 'playing') notePractice();
  const key = segmentKey(value);
  if (key !== practicedSegment?.key || key === suppressedSegment) return true;
  try {
    if (!historyStore) historyStore = createHistoryStore(localStorage, scopePath);
    // A deletion in another window must not be undone by an idle position save.
    if (practicedSegment.saved && !historyStore.read().some(entry => segmentKey(entry) === key)) {
      suppressedSegment = key;
      return true;
    }
    history = historyStore.record(value, { title:videoTitle, practicedAt:practicedSegment.practicedAt });
    practicedSegment.saved = true;
    historyErrorShown = false;
    renderHistory();
    return true;
  } catch {
    if (!historyErrorShown) status('History could not be saved. You can still practice; try freeing browser storage.', true);
    historyErrorShown = true;
    return false;
  }
}

function acceptConsent(persist = true) {
  if (persist) {
    try { localStorage.setItem(consentKey, 'yes'); } catch { /* Consent remains valid for this session. */ }
  }
}

function snapshot() {
  if (!player || !initialized) return saved;
  if (!validateRange(parseTime($('point-a').value), parseTime($('point-b').value), duration) || !validateRange(loop.a, loop.b, duration)) return null;
  return { schema:1, source:'youtube', videoId, a:loop.a, b:loop.b, position:player.getCurrentTime(), rate:player.getRate(), repeat:loop.enabled };
}

function persist() {
  if (forgotten) return true;
  const value = snapshot();
  if (!value) return true;
  saved = value;
  try {
    if (!store) store = createSettingsStore(localStorage, scopePath);
    if (!sessionStore) sessionStore = createSettingsStore(sessionStorage, scopePath);
    // Keep this window's update/reload snapshot independent. Only the focused
    // window owns the shared setup used when a new window is opened.
    sessionStore.write(value);
    if (document.hasFocus()) store.write(value);
    storageErrorShown = false;
    return persistHistory(value);
  } catch {
    if (!storageErrorShown) status('The current loop could not be saved. Keep this window open or share the loop to keep a copy.', true);
    storageErrorShown = true;
    return false;
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 200);
}

function renderRepeat() {
  $('repeat-button').setAttribute('aria-pressed', String(Boolean(loop?.enabled)));
}

function renderRates(rates = player?.getRates() || [1]) {
  const accepted = player?.getRate() || 1;
  $('speed').replaceChildren(...rates.map(rate => {
    const option = document.createElement('option');
    option.value = rate;
    option.textContent = `${rate}×`;
    return option;
  }));
  $('speed').value = String(accepted);
  $('speed').disabled = rates.length <= 1;
}

function requestRate(rate, notify = false) {
  requestedRate = rate;
  clearTimeout(rateTimer);
  if (!player?.setRate(rate)) {
    if (notify) status('That speed is not available for this video.', true);
    renderRates();
    return;
  }
  rateTimer = setTimeout(() => {
    if (notify && player && player.getRate() !== requestedRate) status(`YouTube kept the speed at ${player.getRate()}×. Try another available speed.`, true);
    renderRates();
    scheduleSave();
  }, 1500);
}

function restoreRate() {
  if (!player || pendingRate === null) return;
  if (player.getRates().includes(pendingRate)) {
    const rate = pendingRate;
    pendingRate = null;
    requestRate(rate);
  } else if (player.getState() === 'playing') {
    pendingRate = null;
    status(`The saved speed is unavailable for this video. Using ${player.getRate()}×.`, false, true);
  }
}

function renderPoints() {
  $('point-a').value = formatTime(loop.a, true);
  $('point-b').value = formatTime(loop.b, true);
}

function setPoints(a, b, {format = true} = {}) {
  const valid = validateRange(a, b, duration);
  $('range-error').hidden = valid;
  $('range-error').textContent = valid ? '' : `Choose A before B, at least 0.5 seconds apart, within ${formatTime(duration, true)}.`;
  $('point-a').setAttribute('aria-invalid', String(!valid));
  $('point-b').setAttribute('aria-invalid', String(!valid));
  loop.setRange(a, b);
  renderRepeat();
  if (valid) {
    if (format) renderPoints();
    if (player.getState() === 'playing') notePractice();
    scheduleSave();
  }
  return valid;
}

function initializeDuration() {
  if (!player) return;
  const nextDuration = player.getDuration();
  if (!Number.isFinite(nextDuration) || nextDuration <= 0) return;
  if (initialized && nextDuration > initialDuration + 1 && !changingDuration) {
    changingDuration = true;
    loop.setEnabled(false);
    $('repeat-button').disabled = true;
    status('This video’s duration is changing. Use a recorded video for fixed A–B repeat points.', true);
  }
  duration = nextDuration;
  $('seek').max = duration;
  $('duration').textContent = formatTime(duration);
  if (initialized) return;
  initialized = true;
  initialDuration = duration;
  const restored = pendingRestore && restoreForDuration(pendingRestore, duration);
  if (restored) {
    setPoints(restored.a, restored.b);
    loop.setEnabled(restored.repeat);
    renderRepeat();
    pendingRate = restored.rate;
    if (pendingRestore.position > duration) player.load(videoId, restored.position);
    restoreRate();
  } else {
    setPoints(0, Math.min(5, duration));
    if (pendingRestore) {
      player.load(videoId, 0);
      status('The saved passage does not fit this video. Set new A and B points.', true);
    }
  }
  pendingRestore = null;
  $('repeat-button').disabled = duration < 0.5;
}

async function loadVideo(id, restore = null) {
  const token = ++generation;
  titleController?.abort();
  clearTimeout(rateTimer);
  clearTimeout(saveTimer);
  player?.pause();
  loop?.destroy();
  player?.destroy();
  player = null;
  loop = null;
  initialized = false;
  forgotten = false;
  duration = 0;
  initialDuration = 0;
  changingDuration = false;
  practicedSegment = null;
  suppressedSegment = null;
  playbackActive = false;
  videoTitle = restore?.title || history.find(entry => entry.videoId === id)?.title || '';
  pendingRate = null;
  videoId = id;
  pendingRestore = restore;
  $('load-button').disabled = true;
  $('load-button').textContent = 'Loading…';
  renderHistory();
  $('workspace').hidden = false;
  $('playback-controls').hidden = true;
  $('range-error').hidden = true;
  const playerElementId = `youtube-player-${token}`;
  $('player-container').replaceChildren(Object.assign(document.createElement('div'), { id:playerElementId, className:'youtube-player' }));
  $('video-url').value = `https://www.youtube.com/watch?v=${id}`;
  status('Loading YouTube…');
  try {
    const nextPlayer = await createYouTubePlayer({
      element: playerElementId, videoId:id, startSeconds:restore?.position || 0,
      onStateChange(state) {
        if (token !== generation) return;
        $('play-button').textContent = state === 'playing' || state === 'buffering' ? 'Pause' : 'Play';
        initializeDuration();
        restoreRate();
        if (state === 'playing') {
          notePractice(!playbackActive);
          playbackActive = true;
          scheduleSave();
        } else if (['paused', 'cued', 'unstarted'].includes(state) || (state === 'ended' && !loop?.enabled)) playbackActive = false;
        if (state === 'paused' || state === 'ended') scheduleSave();
      },
      onRatesChange(rates) { if (token === generation) { renderRates(rates); restoreRate(); } },
      onRateChange(rate) {
        if (token !== generation) return;
        $('speed').value = String(rate);
        scheduleSave();
      },
      onError(message, blockerHelp = false) {
        if (token !== generation) return;
        loop?.setEnabled(false);
        renderRepeat();
        status(message, true, false, blockerHelp);
      }
    });
    if (token !== generation) { nextPlayer.destroy(); return; }
    player = nextPlayer;
    loop = new LoopController({
      player,
      onRepeatChange(enabled, message) { renderRepeat(); if (message) status(message, false, true); scheduleSave(); },
      onError(message) { status(message, true); }
    });
    $('playback-controls').hidden = false;
    renderRates();
    initializeDuration();
    titleController = new AbortController();
    const titleRequest = titleController;
    const titleTimeout = setTimeout(() => titleRequest.abort(), 8000);
    fetchYouTubeTitle(id, { signal:titleRequest.signal }).then(title => {
      if (title && token === generation) { videoTitle = title; scheduleSave(); }
    }).finally(() => clearTimeout(titleTimeout));
    if (!$('status').classList.contains('error')) status();
    return true;
  } catch (error) {
    if (token === generation) {
      $('workspace').hidden = true;
      $('player-container').replaceChildren();
      status(error.message || 'YouTube could not load. Try again.', true, false, error.blockerHelp === true);
    }
  } finally {
    if (token === generation) {
      $('load-button').disabled = false;
      $('load-button').textContent = 'Load';
      renderHistory();
    }
  }
}

$('load-form').addEventListener('submit', event => {
  event.preventDefault();
  const id = parseYouTubeURL($('video-url').value);
  if (!id) { status('Enter a YouTube video link, such as youtube.com/watch?v=… or youtu.be/….', true); $('video-url').focus(); return; }
  if (!navigator.onLine) { status('Connect to the internet to load YouTube. Your saved loop is still here.', true); return; }
  acceptConsent();
  persist();
  const restore = saved?.videoId === id ? saved : null;
  loadVideo(id, restore);
});

$('history-list').addEventListener('click', async event => {
  const button = event.target.closest('button');
  const key = button?.closest('li')?.dataset.segmentKey;
  const entry = history.find(value => segmentKey(value) === key);
  if (!entry) return;
  if (button.classList.contains('history-share')) {
    openShare(entry, button);
    return;
  }
  if (button.classList.contains('history-delete')) {
    try {
      history = historyStore.remove(key);
      if (practicedSegment?.key === key) suppressedSegment = key;
      renderHistory();
    } catch { status('That history entry could not be deleted. Try again.', true); }
    return;
  }
  if ($('load-button').disabled) return;
  if (!navigator.onLine) { status('Connect to the internet to load YouTube. Your history is still here.', true); return; }
  acceptConsent();
  persist();
  if (await loadVideo(entry.videoId, { ...entry, position:entry.a })) $('play-button').focus();
});

$('clear-history').addEventListener('click', () => {
  try {
    historyStore.clear();
    const current = snapshot();
    suppressedSegment = current ? segmentKey(current) : practicedSegment?.key || null;
    history = [];
    renderHistory();
    $('video-url').focus();
    status('History cleared.', false, true);
  } catch { status('History could not be cleared. Try again.', true); }
});

window.addEventListener('storage', event => {
  if (event.key !== historyKey(scopePath) && event.key !== null) return;
  try {
    history = historyStore.read();
    if (practicedSegment && (practicedSegment.saved || event.newValue === null) && !history.some(entry => segmentKey(entry) === practicedSegment.key)) suppressedSegment = practicedSegment.key;
    renderHistory();
  } catch { status('History could not be read. You can still practice.', true); }
});

$('play-button').addEventListener('click', () => {
  if (!player) return;
  if (['playing','buffering'].includes(player.getState())) player.pause();
  else player.play();
});
$('repeat-button').addEventListener('click', () => {
  if (!loop || !initialized) { status('Start the video so YouTube can report its duration.', true); return; }
  if (!loop.enabled && !setPoints(parseTime($('point-a').value), parseTime($('point-b').value))) return;
  loop.setEnabled(!loop.enabled);
  renderRepeat();
  scheduleSave();
});
$('set-a').addEventListener('click', () => {
  if (initialized) setPoints(Math.round(player.getCurrentTime()*10)/10, parseTime($('point-b').value));
  if (loop) $('point-a').value = formatTime(loop.a, true);
});
$('set-b').addEventListener('click', () => {
  if (initialized) setPoints(parseTime($('point-a').value), Math.round(player.getCurrentTime()*10)/10);
  if (loop) $('point-b').value = formatTime(loop.b, true);
});
for (const id of ['point-a','point-b']) {
  $(id).addEventListener('change', () => {
    if (initialized) setPoints(parseTime($('point-a').value), parseTime($('point-b').value));
  });
}
$('speed').addEventListener('change', () => { pendingRate = null; requestRate(Number($('speed').value), true); });
$('seek').addEventListener('input', () => {
  scrubbing = true;
  $('current-time').textContent = formatTime(Number($('seek').value));
});
$('seek').addEventListener('change', () => {
  if (player && initialized) {
    const position = Number($('seek').value);
    if (['cued','unstarted','ended'].includes(player.getState())) {
      // Cue preserves silence before the listener's first Play gesture.
      if (loop.enabled && (position < loop.a || position >= loop.b)) loop.setEnabled(false);
      const range = { a:loop.a, b:loop.b, repeat:loop.enabled, rate:player.getRate() };
      player.load(videoId, position);
      loop.reset();
      loop.setRange(range.a, range.b);
      loop.setEnabled(range.repeat);
      requestRate(range.rate);
    } else loop.manualSeek(position);
    scheduleSave();
  }
  scrubbing = false;
});
$('seek').addEventListener('blur', () => { scrubbing = false; });

setInterval(() => {
  if (!player) return;
  initializeDuration();
  if (!initialized) return;
  loop.tick();
  const position = player.getCurrentTime();
  if (!scrubbing) {
    $('seek').value = position;
    $('seek').setAttribute('aria-valuetext', `${formatTime(position)} of ${formatTime(duration)}`);
    $('current-time').textContent = formatTime(position);
  }
  if (Math.abs(position-lastSavedPosition) >= 5) { lastSavedPosition = position; persist(); }
}, 80);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { player?.pause(); persist(); }
});
window.addEventListener('pagehide', () => { player?.pause(); persist(); });
window.addEventListener('offline', () => status('You’re offline. YouTube playback needs an internet connection.', true));
window.addEventListener('online', () => { if ($('status').textContent.includes('offline')) status('Back online. Load the video again if playback stopped.', false, true); });
if (!navigator.onLine) status('You’re offline. Connect to load YouTube; your saved loop is available.', true);

$('about-button').addEventListener('click', () => $('about-dialog').showModal());
let aboutOpener = $('about-button');
$('about-button').addEventListener('click', () => { aboutOpener = $('about-button'); });
$('privacy-button').addEventListener('click', () => {
  aboutOpener = $('privacy-button');
  $('privacy-details').open = true;
  $('about-dialog').showModal();
});
$('about-dialog').addEventListener('close', () => aboutOpener.focus());
let shareOpener;
function openShare(value, opener) {
  try {
    $('share-link').value = createShareLink(value, location.href);
    shareOpener = opener;
    $('share-status').hidden = true;
    $('share-dialog').showModal();
    $('share-link').select();
  } catch (error) { status(error.message, true); }
}
$('share-loop').addEventListener('click', event => openShare(snapshot(), event.currentTarget));
$('share-dialog').addEventListener('close', () => {
  if (shareOpener?.isConnected) shareOpener.focus();
});
$('copy-share-link').addEventListener('click', async () => {
  const field = $('share-link');
  try {
    await navigator.clipboard.writeText(field.value);
    $('share-status').textContent = 'Link copied.';
  } catch {
    field.focus(); field.select();
    $('share-status').textContent = 'Copy access is unavailable. Copy the selected link.';
  }
  $('share-status').hidden = false;
});

function stageLoop(value) {
  persist();
  ++generation;
  clearTimeout(saveTimer);
  player?.pause(); loop?.destroy(); player?.destroy();
  player = null; loop = null; initialized = false; videoId = null;
  practicedSegment = null;
  titleController?.abort();
  forgotten = false;
  saved = value;
  $('workspace').hidden = true;
  $('load-button').disabled = false;
  $('load-button').textContent = 'Load';
  $('video-url').value = `https://www.youtube.com/watch?v=${value.videoId}`;
}
function openSharedLoop() {
  try {
    const value = readShareLink(location.hash);
    if (!value) return;
    stageLoop(value);
    status('Shared loop opened. Load the video to practice.', false, true);
  } catch (error) { status(error.message, true); }
}
window.addEventListener('hashchange', openSharedLoop);
openSharedLoop();

$('export-settings').addEventListener('click', () => {
  try {
    persist();
    const entries = historyStore.read();
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schema:1, app:'riffbolt', history:entries },null,2)], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'riffbolt-history.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch { $('about-dialog').close(); status('History could not be exported. Try again.', true); }
});
$('import-settings').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 1000000) throw new Error('Choose a Riffbolt history file smaller than 1 MB.');
    const value = JSON.parse(await file.text());
    // Continue accepting loop files exported before history backups were added.
    const legacy = validateSnapshot(value);
    if (legacy) {
      stageLoop(legacy);
      persist();
      status('Loop imported. Load the video to restore the passage.', false, true);
    } else {
      if (value?.schema !== 1 || value.app !== 'riffbolt' || !Array.isArray(value.history)) throw new Error('This is not a valid Riffbolt history file.');
      if (!historyStore) historyStore = createHistoryStore(localStorage, scopePath);
      history = historyStore.merge(value.history);
      forgotten = false;
      renderHistory();
      status('History imported and merged with saved loops.', false, true);
    }
    $('about-dialog').close();
  } catch (error) { $('about-dialog').close(); status(error.message || 'That history file could not be read.', true); }
});
$('forget-settings').addEventListener('click', () => {
  try {
    localStorage.removeItem(settingsKey);
    sessionStorage.removeItem(settingsKey);
    localStorage.removeItem(consentKey);
    if (!historyStore) historyStore = createHistoryStore(localStorage, scopePath);
    historyStore.clear();
    history = [];
    practicedSegment = null;
    renderHistory();
    saved = null;
    forgotten = true;
    $('youtube-consent').hidden = false;
    $('about-dialog').close();
    status('Saved loop, practice history, and YouTube consent removed. The current session will not be saved until you load a video again.', false, true);
  } catch { $('about-dialog').close(); status('Saved browser data could not be removed. Try again in your browser’s site settings.', true); }
});

setupPWA({
  beforeUpdate: async () => {
    clearTimeout(saveTimer);
    player?.pause();
    if (initialized && !validateRange(parseTime($('point-a').value), parseTime($('point-b').value), duration)) {
      for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
      status('Correct the A–B range before updating so the current passage can be saved.', true);
      return false;
    }
    const success = persist();
    if (!success) {
      for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
      status('Update paused because the current loop could not be saved. Share the loop to keep a copy, then retry when storage is available.', true);
    }
    return success;
  },
  onStatus: status
});
