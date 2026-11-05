# Practice looper — implementation plan

Updated: November 4, 2026. “Practice looper” is a working description, not final branding.

## Implementation status — November 4, 2026

The user authorized implementation and selected **YouTube only** for the first release. The minimal practice flow, validated settings, install help, explicit updates, offline app shell, and independent update recovery are implemented. Apple Music and local files remain outside this release. See [README](README.md), [YouTube feasibility evidence](evidence/YOUTUBE.md), and [release verification](evidence/RELEASE.md) for delivered behavior and remaining physical-device checks. The original planning discussion below is retained as context; its earlier implementation-authorization caveat has been superseded by the user's instruction to proceed.

## Purpose and current scope

Make it easy to repeat a short passage while practicing guitar: choose music, mark a start and end, and play that passage at a useful speed.

This document plans the product. Creating it does not authorize implementation, account setup, purchases, or deployment.

### Requirements established in the discussion

- Explore a static, installable web app suitable for GitHub Pages.
- Support the phrase-looping use case with YouTube and/or Apple Music; evaluate their practical limits before choosing the first release's sources.
- Follow the folder's minimal-interface requirements: give playback and loop controls the available space, with no decorative sections or redundant copy.
- Keep streaming playback within each provider's documented player and permissions.
- Do not promise seamless streaming loops, offline subscription music, or device behavior that has not been tested.

### Proposed choices, not additional user requirements

- Start with a short playback feasibility prototype, then ship one complete practice flow before adding another source.
- Consider local audio files as a precise, offline-capable core alongside streaming. Local-file support is a recommendation, not an agreed requirement.
- Use plain HTML, CSS, and JavaScript unless an identified audio need justifies a dependency.
- Keep the app free of its own accounts and server-side user storage. Apple Music still requires the listener's authorization and subscription for full songs.
- Defer recording, overdubbing, stem separation, pitch transposition, automatic chord detection, shared libraries, and practice analytics.

## Source capabilities and limits

| Source | Initial interaction | Supported approach | Boundary |
| --- | --- | --- | --- |
| YouTube | Paste a video link | Visible official embedded player; read current time, seek, and select the speeds available for that video | Streaming only; embedding restrictions, buffering, ads, and seek precision affect practice |
| Apple Music | Authorize, then find/select a song | MusicKit JS playback, `seekToTime`, and documented `playbackRate` | Subscription and developer setup; prove playback behavior on target browsers before promising it |
| Local file, if included | Choose a supported, unprotected audio file | Read on device; control loop boundaries and playback without uploading | Browser codec support and memory limits; accurate looping plus pitch-preserving slowdown needs deliberate audio work |

The common interface should expose only capabilities that the active source actually supports.
YouTube's speed list is source-provided; a requested rate is not necessarily accepted.
Apple's current web documentation describes rates above and below 1.0, but this is not proof of reliable full-song slowdown on every browser.
Neither streaming API supplies a guaranteed seamless A–B phrase-loop engine; implement repeat behavior through supported time/seek controls and measure the result.

### Streaming boundaries

- Keep YouTube's player visible, large enough for its controls, and unobstructed; do not offer hidden-player or background-play features.
- Do not extract audio, download/cache streaming tracks for offline use, block ads, or replace either provider's playback engine.
- Preserve standard playback controls and the ability to play a full song when integrating Apple Music.
- Cache the app's own shell and assets only. Offline installation does not make streaming content available offline.
- Do not add synchronized accompaniment, custom processing of protected streams, or other features outside the documented integrations.
- Include required provider attribution and terms/privacy access without turning the main screen into an explanatory page.

## Stage 1 — resolve playback feasibility

Build the smallest disposable prototype that can load one item, mark A/B points, change speed, and repeat.

1. Verify YouTube playback, available speeds, repeated seeking, unavailable embeds, and recovery after buffering.
2. Obtain the necessary Apple developer setup through the user; do not assume credentials or membership exist.
3. With an authorized Apple Music subscriber, prove full-song playback, half-speed playback if accepted, and repeated five-second A–B playback.
4. Test Apple authorization and playback in desktop browsers, iPhone Safari, and an installed iPhone app early.
5. Measure audible gaps and boundary variation over repeated loops; record actual results instead of assuming a timing guarantee.
6. If local files are selected for scope, compare a simple media-element implementation with an audio-buffer approach using the same short passage.

Deliver a small evidence table: source, device/browser, authorization result, accepted speeds, observed loop behavior, and failures.
Choose the first release's sources based on that evidence and the user's intended music source.
If an integration fails, describe the exact unsupported behavior; do not bypass DRM or undocumented player restrictions.

### Apple credentials on a static site

- Initialize MusicKit with a signed developer token; sign it outside the browser using the private MusicKit key.
- Never put the private signing key in client code, a public repository, or published assets.
- A pre-signed token allows a static frontend without a runtime backend. Renew and redeploy before its expiry, which Apple limits to at most six months.
- Prefer an origin-restricted token. Set a documented renewal procedure; private build automation is optional, not required for the first release.
- Let MusicKit handle subscriber authorization through its supported flow; do not invent an app-owned login or copy credentials into custom storage.
- Verify expired-token and canceled-authorization recovery as part of the prototype.

## Stage 2 — build the minimal practice flow

Primary flow: choose source → load music → set A → set B → enable repeat → adjust speed → practice.

- Show the active source's player, current position, a simple seek control, A/B controls, repeat toggle, play/pause, and supported speed choices.
- Make A and B adjustable with an accessible numeric time input or small nudges so correcting a boundary does not require starting over.
- Keep source selection and essential playback actions easy to reach on a phone with a guitar in hand.
- Keep install help, About, and saved-point management in a compact menu if those functions are included.
- Use one brief initial instruction only when necessary. Show transient success feedback and actionable errors at the relevant control.
- Reject invalid ranges such as B at/before A or points outside the loaded track; handle a changed or unavailable source without silently applying old points.
- Recheck time after seeks, speed changes, buffering, and resume; prevent concurrent loop seeks from accumulating.
- Treat user pause, manual seeking, and provider controls as authoritative. Never let the repeat controller fight them.
- Evaluate every visible element before delivery; remove any element whose removal preserves usability and requested functionality.

## Stage 3 — persistence, installation, and updates

Follow [the shared GitHub Pages/PWA guidance](../GITHUB_PAGES_PWA_TIPS.md) when implementing and releasing.

- Scope storage and caches to this app and its deployed path; preserve neighboring apps on the same GitHub Pages origin.
- Save small practice settings: source identifier, A/B points, requested/accepted speed, and repeat preference. Validate restored data against the loaded item.
- Store only the metadata needed to restore the user's practice setup, subject to provider rules; avoid saving catalog responses or authorization data unnecessarily.
- For local files, default to keeping audio in memory and asking the user to choose the file again after reopening. Persistent file storage is a separate future choice.
- Reopening restores the setup but does not automatically start sound. A remembered local filename does not prove the reselected file is the same recording.
- Preserve current points, position, and preferences during an explicitly requested update; pause playback before reloading.
- Offer downloaded updates without forcing activation or reload during playback. Another window's update must not interrupt the current practice session.
- Provide independent update recovery without deleting settings, and report storage failures without claiming the setup was saved.
- Use relative paths, an app-scoped manifest/service worker, and versioned release assets. Verify the eventual deployment at its actual project subpath.

## Acceptance checks before release

- Complete the main practice flow using touch and keyboard; accessible names, focus behavior, contrast, and time inputs remain usable at larger text sizes.
- On a real iPhone, test portrait/landscape in Safari and after installation, including safe areas, the keyboard, and authorization returning to the app.
- Repeat a short passage at normal and supported slower speeds for several minutes; document boundary gaps/variation and verify that controls remain responsive.
- Test setting/revising boundaries, B near track end, source changes, manual seeks, pause/resume, buffering, and a source that cannot play.
- Test Apple sign-in cancellation, expired developer token, unavailable subscription/catalog item, and actual full-song speed changes if Apple Music ships.
- Test YouTube disabled embeds and unsupported speeds if YouTube ships; preserve the visible player and its controls throughout.
- If local audio ships, test supported and unsupported formats, a long file, a reselected different file, and offline reopening behavior.
- Verify saved points survive ordinary reopening and explicit updates, failed storage is reported, and updates in another window do not stop playback.
- Offline, the app opens and explains unavailable streaming actions; it never presents a cached shell as offline streaming playback.
- Run focused unit tests for range validation, source-state transitions, and saved-state restoration; use integration/manual checks for actual provider playback.
- For an authorized release, run project checks, deploy, verify live assets and update behavior, and report device tests that were actually performed.

## Decisions and risks still open

- First-release source combination: YouTube, Apple Music, local files, or a subset; local files are not a substitute for the user's preferred streaming source by assumption.
- Acceptable repeat gap and boundary precision for guitar practice, especially very short passages.
- Apple Music full-song slowdown, repeated seeks, and authorization in the installed iPhone context.
- Whether native browser slowdown sounds good enough; high-quality local time stretching may justify additional processing and dependency review.
- Final name, artwork, repository/deployment address, Apple developer setup, and ownership of token renewal.

## Primary references

- [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference): seeking, available rates, player size, events, and embed errors.
- [YouTube developer policies](https://developers.google.com/youtube/terms/developer-policies): visible playback, content handling, and required disclosures.
- [MusicKit v3 instance reference](https://js-cdn.music.apple.com/musickit/v3/docs/index.html?path=/docs/reference-javascript-musickit-instance--page): `seekToTime`, `playbackRate`, authorization-dependent playback, and repeat behavior.
- [Apple developer tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens): signing, origins, and expiry.
- [Apple Developer Program agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/): MusicKit content and playback requirements.
- [Web Audio loop boundaries](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/loopStart) and [media pitch preservation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preservesPitch): distinct local-audio building blocks, not an automatic seamless-loop guarantee.
