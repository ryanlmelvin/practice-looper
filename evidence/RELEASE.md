# Release verification

Implementation date: November 4, 2026 (America/Chicago).

First-release scope: YouTube only. The user explicitly excluded local audio and did not select Apple Music. The working project name, Practice looper, is retained.

## Automated checks

- 42 Node tests: range validation; repeated seeks; pending/failed seeks; pause/buffering/end behavior; manual seeking; URL parsing; provider failures; accepted speeds; snapshot validation, restoration, and storage errors; service-worker cache isolation; update consent, save failure, timeout, and installation behavior.
- 10 passing Chrome browser app tests use a controlled YouTube API fixture. These verify app behavior, not YouTube timing or sound quality.
- 4 passing real-worker Chrome browser tests serve two independently identified releases at the actual `/practice-looper/` prefix. They verify offline reopening, downloaded updates accepted offline, waiting-worker startup discovery, one reload, preservation of settings, another window's separate reload choice, failed required downloads, and independent recovery.
- Responsive checks include 320 px, 390 px, and 844 px widths, visible YouTube viewport minimums, native dialog dismissal/focus, and overflow. These are desktop browser checks rather than physical iPhone certification.

The complete `npm run check` passed: 42 unit tests, a production build, and 14 browser tests. Verified build: `bce79d7cb0ca`. Real-worker tests caught and fixed a download stall: the worker now consumes each response body before staging a complete cache, preventing browser connection limits from blocking later assets.

See [YouTube evidence](YOUTUBE.md) for live provider observations.

## Device checks still required

- Actual iPhone Safari and installed Home Screen app in portrait/landscape, including safe areas and focusing/editing the time fields.
- Listening to repeated music passages for audible gaps and slowdown quality. Media-clock measurements cannot establish audible latency.
- Real-device native installation and reconnect behavior under a changing mobile connection.

The layout reserves all four safe-area insets, uses 16 px inputs, and includes the shared guide's compact installed-iPhone top-spacing workaround. Those precautions do not prove the physical device outcome.
