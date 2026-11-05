# YouTube feasibility

Scope chosen by the user: YouTube only. Apple Music and local files are excluded from this release.

## Integration evidence

| Source / environment | Authorization | Speeds | Loop behavior | Limits |
| --- | --- | --- | --- | --- |
| Official YouTube IFrame API documentation | No app-owned login for public embeds | Read the video's available rates; confirm the accepted rate through the player event | `seekTo` supports repeated seeking; playback can resume at an earlier keyframe | No seamless-loop guarantee; private, removed, and embedding-disabled videos return errors |
| Automated app tests | Simulated player; no account | Controlled test values | Checks the app's repeat decisions and validation | Does not establish real YouTube or audible timing behavior |
| macOS, headless Chrome 156.0.8078.74, live YouTube at the local project path | Public embed played without app authorization | 0.25×, 0.5×, 0.75×, 1×, 1.25×, 1.5×, 1.75×, 2× offered; 1× and 0.5× accepted | 26 observed repeats over three minutes; details below | One official sample video; audible gaps and ad timing not measured |
| Physical iPhone Safari / installed PWA | Not tested | Not measured | Not measured | Must be checked on an actual device |

The adapter cues a video without autoplay. Restored position uses `cueVideoById` because seeking an unstarted video can begin playback. Video changes reset the player's rate. The app uses the visible official player and preserves its controls. The frame must remain at least 200 × 200 pixels.

Source: [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference).

Loading a video accepts the app's accessible privacy policy through the visible notice. The app links to YouTube's terms and Google's privacy policy. Playback remains in YouTube; the app does not extract, cache, or process the stream or provide background playback.

Source: [YouTube developer policies](https://developers.google.com/youtube/terms/developer-policies).

## Live playback measurement — November 4, 2026

Used the real official YouTube embed for `M7lc1UVf-VE` at `http://127.0.0.1:4320/practice-looper/`, with A = 2 seconds and B = 7 seconds. Playback reported a duration of 22:23. These checks used the unmodified deployed app, with no simulated player or intercepted YouTube response.

| Accepted speed | Observation time | Observed returns to A | Last sampled position before return | First sampled position after return |
| --- | --- | --- | --- | --- |
| 1× | 90 seconds | 17 | 6.9–7.1 seconds | 2.0 seconds |
| 0.5× | 90 seconds | 9 | 7.0 seconds | 2.0 seconds |

The app timeline was sampled every 100 milliseconds and has 0.1-second precision. These are observed playback-position boundaries, **not measurements of audible gaps or sample-accurate seeking**. Repeat stayed enabled throughout; the app reported no playback errors, and no JavaScript errors occurred. Two advertising-domain requests were refused at the network level in this environment; the app did not intercept or suppress them, and ad timing remains unverified.

Ten deterministic browser tests separately passed for consent before loading YouTube, invalid links, embed errors and retry, A/B validation, accepted and refused speed changes, repeat and pause, manual seek authority, quiet restoration after reload, malformed imports, and 320px/390px portrait plus 844px landscape layouts and dialogs. Their simulated player establishes app behavior, not provider timing. The wider project check also covers the PWA lifecycle.

## Remaining hands-on checks

Repeat an actual practice song and listen for gaps. Test real provider controls, network buffering, ads, denied embeds, and installed-iPhone portrait and landscape. Record the exact browser and device with those results; do not infer physical-device or audible outcomes from headless or simulated tests.
