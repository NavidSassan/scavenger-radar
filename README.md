# Scavenger Radar

A Star-Wars-flavoured "targeting computer" for a scavenger hunt. Players enter
two access codes, then a radar points them toward the next location with a dot
and a proximity beep that speeds up as they close in.

**Live:** https://navidsassan.github.io/scavenger-radar/

It is a single static web app (PWA). No backend, no accounts. GPS and the phone
compass work without internet, so once the app is loaded onto a phone it runs
fully offline in the field.

> **Note:** This is an AI-generated hobby project, built for a scout scavenger
> hunt. Treat it accordingly: it is not hardened, audited, or production-grade.

## Features

- Two-access-code gate before the radar unlocks.
- Heading-up radar: the dot shows direction and (scaled) distance to the target.
- Proximity beeper: faster and higher-pitched the closer you get. Tap `SND` to mute.
- Distance readout in metres / km.
- On-device setup screen to set the target coordinate and codes on the day.
- Installable to the home screen; loads and runs offline after the first visit.
- Falls back to a North-up radar with a numeric bearing if the phone has no usable compass.

## Using it on the day

The hunt is built around phones the organizer hands out.

1. **Host it** (once, ahead of time): see "Deployment" below. You need an HTTPS URL.
2. **Per phone**: open the URL on wifi or your hotspot, then "Add to Home Screen"
   in Chrome. This caches the app so it works offline afterwards.
3. **Set the target**: long-press the word **"Targeting"** on the start screen
   for 1.2 seconds to open the setup screen, or append `#admin` to the URL.
   Or skip this per-phone step and provision by QR code (see below).

   - On [map.geo.admin.ch](https://map.geo.admin.ch/) click the target spot and
     copy the **WGS 84** latitude/longitude.
   - Enter lat, lon, the two access codes, and the radar edge distance (the
     distance at which the dot sits at the outer ring, default 150 m).
   - Save.
4. **Hand out the phone.** Players enter the access codes and follow the radar.

After setup you can put the phone in airplane mode; GPS and compass still work.

### Provision with a QR code

Instead of typing the target and codes into the admin screen on every phone,
generate one QR that carries the whole config and scan it on each phone:

```sh
./tools/make-qr.sh <lat> <lon> <code1> <code2> --range 150 --out /tmp/qrcode.png
```

Scanning the QR opens the app, stores the target and codes on that phone, and
clears them from the address bar. Players still enter the two codes at the gate
(they find the code words as physical clues), so a scan does not skip the
puzzle. The config travels in the URL fragment and never reaches a server; one
scan is enough, after which the phone works offline.

The script needs the `qrencode` package. It is a local tool and is not part of
the deployed app.

Note: a static app cannot keep a secret, so the QR is not secure. base64url
makes the payload non-obvious, but anyone who decodes the QR can read the target
and codes. Fine for a scout hunt; do not rely on it as security.

The small footer at the bottom shows the running build's short commit SHA.
Compare it to the latest commit to confirm a phone has picked up an update.

To update an installed phone without reinstalling: connect it to internet and
**tap the footer**. If a newer build is deployed, the app reloads onto it; if it
is already current, nothing changes. Do updates at home before the hunt, not in
the field.

## Limitations (be honest with players)

- Phone compass is jittery and may need a figure-8 calibration wave.
- GPS is roughly 5-10 m accurate, so within ~10 m the dot gets unstable. The app
  switches to a "target acquired - search the area" hint instead of pretending
  to be precise.
- The access-code gate is client-side only. It keeps honest players honest; it
  is not real security.

## Deployment

HTTPS is required (for GPS, compass, and offline install). There is no build
step; the files in this folder are the whole app.

### GitHub Pages (recommended, automated)

A workflow at `.github/workflows/deploy.yml` publishes the app on every push to
`main`.

1. Push this repo to GitHub.
2. In **Settings -> Pages -> Build and deployment**, set **Source** to
   **GitHub Actions** (one-time).
3. Push to `main` (or run the workflow manually from the Actions tab). The app
   goes live at `https://<user>.github.io/<repo>/`.

All asset paths are relative, so it works under that `/<repo>/` subpath with no
extra configuration.

### Other hosts

Any static HTTPS host works too (Cloudflare Pages, Netlify, or any web server):
serve the app files from a directory over HTTPS.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how the deploy workflow is built and
what to update when adding files.

## License

The Unlicense (public domain). See [LICENSE](LICENSE).

## Developer docs

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture, local development, the
radar math, and the testing checklist.
