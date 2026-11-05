# Loopnook

[Open Loopnook](https://ryanlmelvin.github.io/practice-looper/)

A small, installable YouTube A–B practice tool. Paste a video link, load it, set A and B, turn on Repeat, and choose a speed supported by the video. Edit times as minutes:seconds or seconds. The official YouTube player stays visible with its own controls.

By [Ryan L. Melvin](https://ryanlmelvin.com).

## What ships

- YouTube only, as selected for the first release. No Apple Music credentials, account setup, or local-file player.
- Editable A/B points, play/pause, seeking, repeat, and accepted playback speeds. Manual seeks outside the passage switch repeat off. Playback pauses when the app is hidden.
- The latest setup is remembered without starting sound on reopen. Each tab preserves its own reload snapshot; the focused tab writes the shared setup for newly opened windows.
- Scrollable history remembers the 100 most recent practiced A–B segments in this browser, newest first. Select a segment to restore its points and speed at A without autoplay. Practicing it again moves it to the top; Delete removes one entry and Clear removes all history.
- Settings export/import in the ••• menu. These files contain the video identifier, position, points, speed, and repeat preference, with no media or authorization credentials.
- Browser Install button, platform help, offline app shell, explicit update/reload choice, and independent [update recovery](https://ryanlmelvin.github.io/practice-looper/update.html).

YouTube requires an internet connection and an embeddable video. Repeat uses supported seeks; it cannot guarantee gapless or sample-accurate boundaries. Advertisements, buffering, keyframes, and browser behavior can affect playback. A changing video duration disables fixed A–B repeat. The app neither downloads nor processes streaming audio.

First load requires agreement to the app privacy/terms notice. The YouTube API and embed are loaded only after the user chooses Load. No application analytics, accounts, or backend are included. GitHub and YouTube handle their own requests according to the linked provider policies.

## Develop and verify

Requires Node.js 22+.

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4317/practice-looper/`. The server uses the actual project prefix and disables HTTP caching. Set `HOST` to your computer's current private Wi-Fi address to preview on another device; local Wi-Fi HTTP does not establish installed-PWA behavior.

```sh
npm test
npm run build
npm run test:browser
```

The browser suite uses installed Chrome on macOS; elsewhere install Chromium with `npx playwright install chromium`. Browser checks cover the app with a controlled YouTube fixture and real service workers with two release versions. Live provider observations and remaining physical-device checks are recorded in [the feasibility evidence](evidence/YOUTUBE.md) and [release verification](evidence/RELEASE.md).

Runtime source is plain JavaScript in `src/`; `public/` holds static templates. The build bundles the app with esbuild, creates content-hashed JavaScript/CSS, hashes release inputs, emits `docs/release.json`, and generates `docs/sw.js` with all required offline app assets. No runtime package or CDN dependency is needed for the app shell.

## Publish

GitHub Pages serves `main` → `/docs`. Run the checks and build, commit the source and generated `docs/`, then push `main`. Verify the Pages deployment and the live `release.json` against the local release. Build output is deterministic; no manual service-worker version bump is needed.

The worker caches only this app's files and preserves earlier hashed assets for windows that have not accepted a new release. Update checks run at startup, on return/online, and once a minute while visible. A downloaded update stays available during playback; accepting it pauses, saves, activates, and reloads once. A failed save blocks activation, and a stalled activation restores the control. Another window's update does not force a reload.

`update.html` is a network-only page with independent inline code. It installs a fresh version without clearing settings or touching neighboring apps. The offline promise covers the app and settings, never YouTube playback.
