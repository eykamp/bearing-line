// app.js — application state, sensors, map, and UI logic

// ── State ─────────────────────────────────────────────────────────────────

const state = {
  compassGranted:  false,
  liveHeading:     null,   // EMA-smoothed degrees, updates continuously
  lockedHeading:   null,   // frozen on lock
  isLocked:        false,
  currentLat:      null,
  currentLng:      null,
  gpsAccuracyM:    null,
  maxDistanceKm:   10,
  needsFit:        false,  // consumed by render() to trigger a fitBounds
  hasInitialFit:   false,  // true after first GPS fix zooms the map in
};

// ── Map objects ───────────────────────────────────────────────────────────

let map      = null;
let polyline = null;
let markers  = [];
let snapPoint = null;   // last tap-to-snap result, used by openInMaps()

// ── Google Maps callback ──────────────────────────────────────────────────

function initMap() {
  map = new google.maps.Map(document.getElementById('map'), {
    center:           { lat: 39.5, lng: -98.35 },  // US centre fallback
    zoom:             4,
    mapTypeId:        google.maps.MapTypeId.HYBRID,
    mapTypeControl:   false,
    streetViewControl: false,
    fullscreenControl: false,
    zoomControl:      true,
  });

  polyline = new google.maps.Polyline({
    geodesic:      true,
    strokeColor:   '#2979FF',
    strokeOpacity: 0.85,
    strokeWeight:  3,
    map:           map,
  });

  map.addListener('click', onMapClick);
}

// ── Sensors ───────────────────────────────────────────────────────────────

// Called when the user taps "Enable Compass & GPS".
// DeviceOrientationEvent.requestPermission() must be called from a user gesture.
async function enableSensors() {
  const btn = document.getElementById('btn-enable');
  btn.disabled = true;

  // Request compass permission (required on iOS 13+)
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== 'granted') {
        showOverlayError('Compass access was denied. Please allow it in Settings → Safari → Motion & Orientation Access.');
        btn.disabled = false;
        return;
      }
    } catch (err) {
      showOverlayError('Could not request compass permission: ' + err.message);
      btn.disabled = false;
      return;
    }
  }

  state.compassGranted = true;
  window.addEventListener('deviceorientation', onOrientation);
  startGps();
  hideOverlay();
}

// Compass smoothing state
let _smoothSin = 0;
let _smoothCos = 1;
const EMA_ALPHA = 0.15;

function onOrientation(event) {
  // webkitCompassHeading: degrees clockwise from true north (when GPS active), iOS Safari only.
  const raw = event.webkitCompassHeading;
  if (raw === null || raw === undefined) return;

  // EMA using sin/cos to handle the 359°→0° wraparound correctly.
  const rad = raw * Math.PI / 180;
  _smoothSin = EMA_ALPHA * Math.sin(rad) + (1 - EMA_ALPHA) * _smoothSin;
  _smoothCos = EMA_ALPHA * Math.cos(rad) + (1 - EMA_ALPHA) * _smoothCos;

  let heading = Math.atan2(_smoothSin, _smoothCos) * 180 / Math.PI;
  if (heading < 0) heading += 360;

  state.liveHeading = heading;
  if (!state.isLocked) render();
}

function startGps() {
  if (!navigator.geolocation) {
    document.getElementById('gps-status').textContent = 'GPS not supported';
    return;
  }
  navigator.geolocation.watchPosition(
    pos => {
      state.currentLat  = pos.coords.latitude;
      state.currentLng  = pos.coords.longitude;
      state.gpsAccuracyM = pos.coords.accuracy;
      render();
    },
    err => {
      console.warn('GPS error:', err.code, err.message);
      document.getElementById('gps-status').textContent = 'GPS error: ' + err.message;
    },
    { enableHighAccuracy: true, maximumAge: 0 }
  );
}

// ── User actions ──────────────────────────────────────────────────────────

function toggleLock() {
  if (state.isLocked) {
    state.isLocked      = false;
    state.lockedHeading = null;
    closeInfoPanel();
  } else {
    if (state.liveHeading === null || state.currentLat === null) return;
    state.lockedHeading = state.liveHeading;
    state.isLocked      = true;
    state.needsFit      = true;
  }
  render();
}

function onSliderChange(value) {
  state.maxDistanceKm = parseFloat(value);
  document.getElementById('slider-value').textContent = value + ' km';
  if (state.isLocked) state.needsFit = true;
  render();
}

// ── Map interactions ──────────────────────────────────────────────────────

function onMapClick(event) {
  if (!state.isLocked) return;
  const origin   = getOrigin();
  const endpoint = getEndpoint();
  if (!origin || !endpoint) return;

  const result = snapToLine(
    event.latLng.lat(), event.latLng.lng(),
    origin.lat,         origin.lng,
    endpoint.lat,       endpoint.lng
  );
  if (!result) return;

  snapPoint = result;
  showInfoPanel(result);
}

// ── Computed values ───────────────────────────────────────────────────────

function getOrigin() {
  if (state.currentLat === null) return null;
  return { lat: state.currentLat, lng: state.currentLng };
}

function getEndpoint() {
  const origin  = getOrigin();
  const heading = state.isLocked ? state.lockedHeading : state.liveHeading;
  if (!origin || heading === null) return null;
  return destinationPoint(origin.lat, origin.lng, heading, state.maxDistanceKm * 1000);
}

// ── Render ────────────────────────────────────────────────────────────────

function render() {
  renderStatusBar();
  renderControls();
  if (!map || !polyline) return;

  const origin   = getOrigin();
  const endpoint = getEndpoint();

  // Centre map on first GPS fix, regardless of whether we have a heading yet.
  if (origin && !state.hasInitialFit) {
    state.hasInitialFit = true;
    map.setCenter({ lat: origin.lat, lng: origin.lng });
    map.setZoom(15);
  }

  if (!origin || !endpoint) {
    polyline.setPath([]);
    clearMarkers();
    return;
  }

  // Update the bearing line.
  polyline.setPath([
    { lat: origin.lat,   lng: origin.lng },
    { lat: endpoint.lat, lng: endpoint.lng },
  ]);

  if (state.isLocked) {
    // Line is static — show distance markers.
    rebuildMarkers(origin);

    if (state.needsFit) {
      state.needsFit = false;
      fitLine(origin, endpoint);
    }
  } else {
    // Line is live — skip markers, keep map centred on user.
    clearMarkers();
    if (!state.hasInitialFit) {
      state.hasInitialFit = true;
      map.setCenter({ lat: origin.lat, lng: origin.lng });
      map.setZoom(15);
    } else {
      map.panTo({ lat: origin.lat, lng: origin.lng });
    }
  }
}

function renderStatusBar() {
  const heading = state.isLocked ? state.lockedHeading : state.liveHeading;

  document.getElementById('gps-status').textContent =
    state.currentLat !== null
      ? `GPS ±${Math.round(state.gpsAccuracyM)} m`
      : 'Waiting for GPS…';

  document.getElementById('heading-display').textContent =
    heading !== null ? heading.toFixed(1) + '°' : '—°';

  document.getElementById('cardinal').textContent =
    heading !== null ? toCardinal(heading) : '';

  document.getElementById('lock-icon').style.display =
    state.isLocked ? 'inline' : 'none';
}

function renderControls() {
  const btn    = document.getElementById('btn-lock');
  const canLock = state.liveHeading !== null && state.currentLat !== null;

  btn.disabled    = !state.isLocked && !canLock;
  btn.textContent = state.isLocked ? 'Unlock Bearing' : 'Lock Bearing';
  btn.className   = 'btn-lock' + (state.isLocked ? ' locked' : '');
}

// ── Map helpers ───────────────────────────────────────────────────────────

function rebuildMarkers(origin) {
  clearMarkers();
  const step = 5;
  for (let d = step; d < state.maxDistanceKm; d += step) {
    const pt = destinationPoint(origin.lat, origin.lng, state.lockedHeading, d * 1000);
    markers.push(new google.maps.Marker({
      position: pt,
      map:      map,
      title:    `${d} km`,
      label: {
        text:       `${d}`,
        color:      '#ffffff',
        fontSize:   '11px',
        fontWeight: 'bold',
      },
      icon: {
        path:        google.maps.SymbolPath.CIRCLE,
        scale:       14,
        fillColor:   '#2979FF',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      },
      zIndex: 10,
    }));
  }
}

function clearMarkers() {
  markers.forEach(m => m.setMap(null));
  markers = [];
}

function fitLine(origin, endpoint) {
  const bounds = new google.maps.LatLngBounds();
  bounds.extend(origin);
  bounds.extend(endpoint);
  map.fitBounds(bounds, { top: 80, right: 50, bottom: 50, left: 50 });
}

// ── Info panel ────────────────────────────────────────────────────────────

function showInfoPanel(result) {
  const lat    = result.lat;
  const lng    = result.lng;
  const distKm = (result.distFromOriginM / 1000).toFixed(2);

  document.getElementById('info-lat').textContent =
    `${Math.abs(lat).toFixed(6)}° ${lat >= 0 ? 'N' : 'S'}`;
  document.getElementById('info-lng').textContent =
    `${Math.abs(lng).toFixed(6)}° ${lng >= 0 ? 'E' : 'W'}`;
  document.getElementById('info-dist').textContent =
    `${distKm} km from your location`;

  document.getElementById('info-panel').classList.remove('hidden');
}

function closeInfoPanel() {
  document.getElementById('info-panel').classList.add('hidden');
  snapPoint = null;
}

function openInMaps() {
  if (!snapPoint) return;
  window.open(`https://maps.google.com/?q=${snapPoint.lat},${snapPoint.lng}`, '_blank');
}

// ── Overlay ───────────────────────────────────────────────────────────────

function hideOverlay() {
  document.getElementById('overlay').classList.add('hidden');
}

function showOverlayError(msg) {
  const el = document.getElementById('overlay-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
