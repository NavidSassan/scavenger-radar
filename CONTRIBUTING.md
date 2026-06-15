# Developer docs

## Overview

Static, dependency-free PWA. Plain HTML + CSS + vanilla JS + Canvas. No build
step, no framework, no backend. The whole app is the files in this folder.

Everything the radar needs runs on the device:

- **GPS**: `navigator.geolocation.watchPosition` (no internet required).
- **Compass**: `deviceorientationabsolute` / `deviceorientation` events.
- **Audio**: Web Audio API oscillator for the proximity beep.

The only internet touch is the initial load, which the service worker caches
away after the first visit.

## File map

| File                     | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `index.html`             | App shell. Three `<section>` views: gate, radar, admin.        |
| `styles.css`             | Star-Wars targeting-computer theme (starfield, CRT, colours).  |
| `app.js`                 | All logic: state, gate, sensors, radar math, beeper, admin.    |
| `manifest.webmanifest`   | PWA metadata (name, icons, standalone display).                |
| `service-worker.js`      | Cache-first offline shell.                                     |
| `icons/`                 | 192px + 512px PWA icons (generated, see below).                |
| `.github/workflows/deploy.yml` | GitHub Pages deploy pipeline.                            |

`app.js` is organized into labelled sections: config persistence, view
switching, geometry, sensors, proximity beeper, radar rendering, gate, admin,
sound toggle, boot.

## Local development

GPS, compass, Web Audio, and service workers all require a **secure context**.
`localhost` counts as secure, so a plain local server is enough for most testing:

```sh
python3 -m http.server 8000
# then open http://localhost:8000 on the dev machine
```

To test on a real phone you need HTTPS (or `localhost` forwarded), because the
phone is not on `localhost`. Options:

- Reverse tunnel (e.g. `cloudflared tunnel --url http://localhost:8000`) gives a
  temporary HTTPS URL.
- Chrome remote debugging: `chrome://inspect` with port-forwarding maps the
  phone's `localhost:8000` to the dev machine, which keeps it a secure context.

Desktop Chrome DevTools can emulate sensors (Sensors tab: override geolocation
and orientation) for quick checks without a phone, but it cannot fully emulate
`deviceorientationabsolute`; verify heading behaviour on a real device.

## Radar math

In `app.js`:

- `distanceMeters()` - haversine great-circle distance.
- `bearingDegrees()` - initial bearing, degrees clockwise from north.
- `compassHeadingFromEvent()` - turns an orientation event into a compass
  heading. Absolute orientation reports `alpha` counter-clockwise from north, so
  the heading of the device top is `360 - alpha`, adjusted by
  `screen.orientation.angle`. iOS `webkitCompassHeading` is used directly if present.
- Heading is low-pass filtered (`onOrientation`) to tame compass jitter,
  handling the 0/360 wrap.
- Draw: screen angle = `bearing - heading` (heading-up). Dot at
  `cx + r·sin(angle)`, `cy - r·cos(angle)`. Radius
  `r = min(distance / range, 1) · radarRadius`.
- No usable compass: `useHeading` is false, the radar stays North-up and the
  status line shows the numeric bearing.

## Proximity beeper

`scheduleBeep()` self-reschedules with `setTimeout`. The interval and the
oscillator frequency are interpolated from `latestDistance / range`:

- Interval: `BEEP_MIN_INTERVAL` (close) … `BEEP_MAX_INTERVAL` (far).
- Pitch: higher when close.

Web Audio is blocked until a user gesture, so `initAudio()` is called from the
"Engage" tap (and from the sound toggle). `latestDistance` is updated each frame
by the draw loop.

## Admin / config

Config lives in `localStorage` under `scavenger-radar-config`:
`{ lat, lon, word1, word2, range }`. The admin screen reads and writes it.
Access codes are compared case-insensitively and trimmed (`normalize()`).

Admin entry points: long-press the word "Targeting" on the gate (1.2 s) or load
with `#admin`.

## Build version stamp

The footer shows the running build. `index.html` ships the literal text `dev`;
the deploy workflow's "Stamp build version" step replaces it with the short
commit SHA (`sed` on `_site/index.html`). Locally it just reads `dev`.

Because the stamp lives in `index.html`, which the service worker serves
cache-first, the footer reflects the build **actually loaded on the device** (the
cached one), not necessarily the latest deploy. That makes it a reliable way to
confirm whether a phone has picked up an update: compare the footer SHA to the
latest commit. To make a phone fetch newer HTML at all, the SW must update, so
remember to bump `CACHE_VERSION` (see below).

## Service worker / releases

`service-worker.js` pre-caches the asset list and serves cache-first.

**When you change any cached file, bump `CACHE_VERSION`** in
`service-worker.js`. The old cache is deleted on activate, so phones pick up the
new version on next load. If you add or rename a file, also update the `ASSETS`
list.

### Updating an installed phone

Caching is cache-first, so a plain reload keeps serving the cached build (and an
installed Android PWA usually resumes rather than reloads, so updates do not land
on their own). The footer is a manual update control: tapping it runs
`checkForUpdate()` in `app.js`, which calls `registration.update()`. If
`CACHE_VERSION` changed, the new worker installs, `skipWaiting()` +
`clients.claim()` activate it, the `controllerchange` event fires, and the page
reloads onto the fresh cache. A `SKIP_WAITING` message handler in the worker
covers the already-waiting case. Offline or already-current taps just restore the
footer label. This needs internet, so update phones before heading out.

## Icons

Generated with Pillow:

```sh
python3 - <<'PY'
# see git history for the generator; draws the radar glyph at 192 and 512 px
PY
```

To change the look, regenerate both sizes and keep the filenames
(`icons/icon-192.png`, `icons/icon-512.png`) referenced by the manifest and
service worker.

## Deployment

`.github/workflows/deploy.yml` deploys to GitHub Pages on every push to `main`
(and via manual `workflow_dispatch`). It uses the Pages Actions pipeline
(`configure-pages` -> `upload-pages-artifact` -> `deploy-pages`), so **no Jekyll
runs** and files are served exactly as uploaded.

The workflow copies only the app files into a `_site/` directory before
uploading, so `.git`, the docs, and the workflow itself are never published.

**When you add or rename an app asset, update the `cp` list in the "Assemble
site" step** so it ships, and keep the service-worker `ASSETS` list in sync (and
bump `CACHE_VERSION`). The two lists should match the real set of runtime files.

One-time repo setup: Settings -> Pages -> Build and deployment -> Source ->
GitHub Actions. The site then serves at `https://<user>.github.io/<repo>/`.
Because every asset path in `index.html`, the manifest, and the service-worker
registration is relative, the app works unchanged under that subpath.

To deploy elsewhere (Cloudflare Pages, Netlify, a plain server), just publish the
same app files over HTTPS; the workflow is GitHub-specific but the app is not.

## Theming notes

The Star-Wars feel is CSS-only (starfield via layered radial-gradients, CRT
scanlines, amber/green/yellow palette, monospace + wide letter-spacing). No font
files are bundled, so it stays offline-clean. To use a real Star-Wars display
font, drop a `woff2` into the folder, `@font-face` it in `styles.css`, add the
file to the service-worker `ASSETS`, and bump `CACHE_VERSION`. Check the font
licence before shipping.

## Testing checklist

Manual, on a real Android phone (see "Verification" in the plan):

1. Serve over HTTPS (or localhost).
2. Admin: set a target ~100-150 m away and two access codes.
3. Gate: wrong codes rejected, correct codes open the radar.
4. Grant location permission; the dot points at the target, distance is plausible.
5. Walk toward it: distance drops, dot moves inward, beep speeds up, "target
   acquired" appears within ~10 m.
6. Turn on the spot: the dot rotates opposite to your turn (heading-up).
7. `SND` button mutes/unmutes the beeper.
8. Airplane mode after install: app still opens and the radar still works.
