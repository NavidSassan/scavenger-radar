'use strict';

// ---------------------------------------------------------------------------
// Scavenger Radar - fully client-side, offline-capable.
// Gate (2 code words) -> heading-up radar pointing at a stored target.
// Target + code words are set on-device via the hidden admin screen.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'scavenger-radar-config';
const DEFAULT_RANGE = 150; // metres mapped to the radar's outer edge
const CLOSE_DISTANCE = 10; // metres; below this the bearing gets unreliable

// --- Config persistence ----------------------------------------------------

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt storage */ }
  return { lat: null, lon: null, word1: '', word2: '', range: DEFAULT_RANGE };
}

function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

let config = loadConfig();

// --- View switching --------------------------------------------------------

const views = {
  gate: document.getElementById('view-gate'),
  radar: document.getElementById('view-radar'),
  admin: document.getElementById('view-admin'),
};

function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    el.hidden = key !== name;
  }
}

// --- Geometry --------------------------------------------------------------

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

// Great-circle distance in metres (haversine).
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Initial bearing from point 1 to point 2, degrees clockwise from north.
function bearingDegrees(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// --- Sensors ---------------------------------------------------------------

let position = null;       // { lat, lon, accuracy }
let heading = null;        // smoothed compass heading, degrees
let headingAvailable = false;
let geoWatchId = null;
let rafId = null;

function compassHeadingFromEvent(e) {
  // iOS exposes a ready-made compass heading.
  if (typeof e.webkitCompassHeading === 'number') return e.webkitCompassHeading;
  if (typeof e.alpha !== 'number') return null;
  // Absolute orientation: alpha is counter-clockwise from north, so the
  // direction the top of the device points is (360 - alpha).
  let h = 360 - e.alpha;
  const screenAngle = (screen.orientation && screen.orientation.angle) || 0;
  h = (h + screenAngle) % 360;
  return (h + 360) % 360;
}

function onOrientation(e) {
  const h = compassHeadingFromEvent(e);
  if (h == null) return;
  headingAvailable = true;
  // Low-pass filter to tame compass jitter, handling the 0/360 wrap.
  if (heading == null) {
    heading = h;
  } else {
    let delta = ((h - heading + 540) % 360) - 180;
    heading = (heading + delta * 0.2 + 360) % 360;
  }
}

function startSensors() {
  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      position = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
    },
    (err) => {
      setStatus(
        err.code === err.PERMISSION_DENIED
          ? 'Location permission denied.'
          : 'Waiting for GPS…'
      );
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 27000 }
  );

  // Prefer the absolute (true-north referenced) event; fall back to relative.
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', onOrientation);
  } else {
    window.addEventListener('deviceorientation', onOrientation);
  }
}

function stopSensors() {
  if (geoWatchId != null) navigator.geolocation.clearWatch(geoWatchId);
  window.removeEventListener('deviceorientationabsolute', onOrientation);
  window.removeEventListener('deviceorientation', onOrientation);
  geoWatchId = null;
}

// --- Proximity beeper ------------------------------------------------------
// A sonar-style blip whose rate (and pitch) rises as the target nears,
// like a missile lock tightening. Web Audio must be unlocked by a user
// gesture (the "Engage" tap), so initAudio() runs from the gate handler.

let audioCtx = null;
let soundEnabled = true;
let beepTimer = null;
let latestDistance = null; // metres, kept fresh by the draw loop

const BEEP_MAX_INTERVAL = 1400; // ms, when far away
const BEEP_MIN_INTERVAL = 110;  // ms, when on top of the target

function initAudio() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx) audioCtx = new Ctx();
}

function blip() {
  if (!audioCtx) return;
  const ratio =
    latestDistance == null
      ? 1
      : Math.min(latestDistance / (config.range || DEFAULT_RANGE), 1);
  const freq = 1100 - ratio * 480; // closer -> higher pitch
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const t = audioCtx.currentTime;
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}

function scheduleBeep() {
  if (!soundEnabled || !audioCtx) return;
  blip();
  const ratio =
    latestDistance == null
      ? 1
      : Math.min(latestDistance / (config.range || DEFAULT_RANGE), 1);
  const interval = BEEP_MIN_INTERVAL + ratio * (BEEP_MAX_INTERVAL - BEEP_MIN_INTERVAL);
  beepTimer = setTimeout(scheduleBeep, interval);
}

function startBeeper() {
  stopBeeper();
  if (soundEnabled && audioCtx) scheduleBeep();
}

function stopBeeper() {
  if (beepTimer) clearTimeout(beepTimer);
  beepTimer = null;
}

// --- Radar rendering -------------------------------------------------------

const canvas = document.getElementById('radar-canvas');
const ctx = canvas.getContext('2d');
const distanceEl = document.getElementById('distance-readout');
const statusEl = document.getElementById('status-line');

let lastStatus = '';
function setStatus(text) {
  if (text !== lastStatus) {
    statusEl.textContent = text;
    lastStatus = text;
  }
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);

function drawRadar() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cx = w / 2;
  const cy = h / 2;
  const radarRadius = Math.min(w, h) * 0.4;

  ctx.clearRect(0, 0, w, h);

  // Concentric rings + crosshair.
  ctx.strokeStyle = 'rgba(74, 222, 128, 0.35)';
  ctx.lineWidth = 1.5;
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (radarRadius * i) / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - radarRadius, cy);
  ctx.lineTo(cx + radarRadius, cy);
  ctx.moveTo(cx, cy - radarRadius);
  ctx.lineTo(cx, cy + radarRadius);
  ctx.stroke();

  // Center marker (the player).
  ctx.fillStyle = 'rgba(74, 222, 128, 0.9)';
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();

  if (!position) {
    setStatus('Acquiring satellites…');
    distanceEl.textContent = '--';
    latestDistance = null;
    return;
  }

  const dist = distanceMeters(position.lat, position.lon, config.lat, config.lon);
  const bearing = bearingDegrees(position.lat, position.lon, config.lat, config.lon);
  latestDistance = dist;

  distanceEl.textContent =
    dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${Math.round(dist)} m`;

  // Heading-up if we have a compass, otherwise north-up with a label.
  const useHeading = headingAvailable && heading != null;
  const screenAngleDeg = useHeading ? bearing - heading : bearing;
  const angle = toRad(screenAngleDeg);

  const r = Math.min(dist / (config.range || DEFAULT_RANGE), 1) * radarRadius;
  const dotX = cx + r * Math.sin(angle);
  const dotY = cy - r * Math.cos(angle);

  // Direction line from center to the target dot.
  ctx.strokeStyle = 'rgba(74, 222, 128, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(dotX, dotY);
  ctx.stroke();

  // Target dot.
  ctx.fillStyle = '#ffb02e';
  ctx.shadowColor = '#ffb02e';
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Targeting reticle (corner brackets) around the dot.
  const b = 18; // bracket extent
  const g = 11; // gap from dot center
  ctx.strokeStyle = '#ffe81f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ctx.moveTo(dotX + sx * g, dotY + sy * b);
      ctx.lineTo(dotX + sx * g, dotY + sy * g);
      ctx.lineTo(dotX + sx * b, dotY + sy * g);
    }
  }
  ctx.stroke();

  // 'N' marker at the top (heading-up) so the player can orient the radar.
  if (useHeading) {
    const nAngle = toRad(-heading);
    const nx = cx + radarRadius * Math.sin(nAngle);
    const ny = cy - radarRadius * Math.cos(nAngle);
    ctx.fillStyle = 'rgba(230, 245, 236, 0.7)';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);
  }

  // Status line.
  if (dist <= CLOSE_DISTANCE) {
    setStatus('Target acquired - search the area!');
  } else if (!useHeading) {
    setStatus(`No compass: North-up. Bearing ${Math.round(bearing)}°`);
  } else {
    setStatus('Hold flat - track the target');
  }
}

function loop() {
  drawRadar();
  rafId = requestAnimationFrame(loop);
}

function startRadar() {
  showView('radar');
  resizeCanvas();
  heading = null;
  headingAvailable = false;
  position = null;
  startSensors();
  startBeeper();
  if (rafId == null) loop();

  // If no compass data arrives, the draw loop already falls back to North-up.
  setTimeout(() => {
    if (!headingAvailable) {
      setStatus('No compass detected. Radar runs North-up.');
    }
  }, 3000);
}

// --- Gate ------------------------------------------------------------------

const gateForm = document.getElementById('gate-form');
const word1Input = document.getElementById('word1-input');
const word2Input = document.getElementById('word2-input');
const gateError = document.getElementById('gate-error');

const normalize = (s) => s.trim().toLowerCase();

gateForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (config.lat == null || config.lon == null) {
    gateError.textContent = 'Not set up yet. Open the admin screen.';
    gateError.hidden = false;
    return;
  }
  const ok =
    normalize(word1Input.value) === normalize(config.word1) &&
    normalize(word2Input.value) === normalize(config.word2) &&
    config.word1 !== '' &&
    config.word2 !== '';
  if (ok) {
    gateError.hidden = true;
    initAudio(); // unlock Web Audio on this user gesture
    startRadar();
  } else {
    gateError.textContent = 'Wrong code words. Try again.';
    gateError.hidden = false;
    views.gate.querySelector('.gate-box').classList.remove('shake');
    void views.gate.offsetWidth; // restart animation
    views.gate.querySelector('.gate-box').classList.add('shake');
  }
});

// --- Admin -----------------------------------------------------------------

const adminLat = document.getElementById('admin-lat');
const adminLon = document.getElementById('admin-lon');
const adminWord1 = document.getElementById('admin-word1');
const adminWord2 = document.getElementById('admin-word2');
const adminRange = document.getElementById('admin-range');
const adminSaved = document.getElementById('admin-saved');

function openAdmin() {
  stopSensors();
  stopBeeper();
  adminLat.value = config.lat ?? '';
  adminLon.value = config.lon ?? '';
  adminWord1.value = config.word1 ?? '';
  adminWord2.value = config.word2 ?? '';
  adminRange.value = config.range ?? DEFAULT_RANGE;
  adminSaved.hidden = true;
  showView('admin');
}

document.getElementById('admin-save').addEventListener('click', () => {
  const lat = parseFloat(adminLat.value.replace(',', '.'));
  const lon = parseFloat(adminLon.value.replace(',', '.'));
  const range = parseInt(adminRange.value, 10);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    adminSaved.textContent = 'Latitude and longitude must be numbers.';
    adminSaved.className = 'error';
    adminSaved.hidden = false;
    return;
  }
  config = {
    lat,
    lon,
    word1: adminWord1.value.trim(),
    word2: adminWord2.value.trim(),
    range: Number.isFinite(range) && range > 0 ? range : DEFAULT_RANGE,
  };
  saveConfig(config);
  adminSaved.textContent = 'Saved.';
  adminSaved.className = 'ok';
  adminSaved.hidden = false;
});

document.getElementById('admin-close').addEventListener('click', () => {
  showView('gate');
});

// --- Sound toggle ----------------------------------------------------------

const soundToggle = document.getElementById('sound-toggle');
soundToggle.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  soundToggle.textContent = soundEnabled ? 'SND ON' : 'SND OFF';
  if (soundEnabled) {
    initAudio();
    startBeeper();
  } else {
    stopBeeper();
  }
});

// Hidden admin entry: long-press the word "Targeting" for 3s, or load with #admin.
// Note: no touchmove cancel, so small finger jitter during the hold is tolerated.
const adminTrigger = document.getElementById('admin-trigger');
const ADMIN_HOLD_MS = 3000;
let pressTimer = null;
function armLongPress() {
  pressTimer = setTimeout(openAdmin, ADMIN_HOLD_MS);
}
function cancelLongPress() {
  if (pressTimer) clearTimeout(pressTimer);
  pressTimer = null;
}
adminTrigger.addEventListener('touchstart', armLongPress, { passive: true });
adminTrigger.addEventListener('touchend', cancelLongPress);
adminTrigger.addEventListener('touchcancel', cancelLongPress);
adminTrigger.addEventListener('mousedown', armLongPress);
adminTrigger.addEventListener('mouseup', cancelLongPress);
adminTrigger.addEventListener('mouseleave', cancelLongPress);

if (location.hash === '#admin') openAdmin();

// --- Boot ------------------------------------------------------------------

showView('gate');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {
      /* offline caching simply unavailable; app still works online */
    });
  });
}
