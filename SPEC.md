# Bearing Line App — Product Specification

**Version:** 2.0
**Platform:** Progressive Web App (PWA) — iOS Safari primary, desktop secondary
**Language:** HTML / CSS / Vanilla JavaScript (no build step, no framework)
**Date:** 2026-03-11

---

## 1. Purpose

A PWA that lets the user point their phone in any direction, lock a compass bearing,
and draw a straight line from their current GPS location along that bearing on an
embedded Google Maps satellite view. Primary use case: identifying distant objects on
the horizon (buildings, cranes, antennas, towers) by exploring what lies along the
line of sight.

Runs entirely in Safari on iPhone. Can be added to the home screen for a near-native
feel. No App Store, no Xcode, no Apple Developer account required.

---

## 2. Core User Flow

1. Open the app in Safari → tap **Enable Compass** (iOS requires a user gesture).
2. GPS and compass initialize.
3. Google Maps loads in hybrid (satellite + labels) mode centred on the user.
4. Point phone toward a distant object on the horizon.
5. Watch the live compass heading update in real time.
6. Tap **Lock Bearing** to freeze the heading.
7. A bearing line is drawn directly on the Google Maps view.
8. Adjust the line length slider (default 10 km, up to 50 km).
9. Pan and zoom the map freely to explore what lies along the line.
10. Tap anywhere near the line to see the coordinates and distance at that point.
11. Tap **Unlock** to aim at a new direction.

---

## 3. Features

### 3.1 MVP

| # | Feature | Description |
|---|---------|-------------|
| 1 | Compass permission prompt | A single **Enable Compass** button shown on load; calls `DeviceOrientationEvent.requestPermission()` on tap |
| 2 | Live compass heading | Displays real-time `webkitCompassHeading` (magnetic north, iOS Safari) smoothed with EMA |
| 3 | Lock / Unlock bearing | Freezes heading; line stops updating while user interacts with map |
| 4 | GPS location | `navigator.geolocation.watchPosition` — updates origin until locked |
| 5 | Bearing line on map | `google.maps.Polyline` drawn live on hybrid map |
| 6 | Distance slider | 1–50 km; default 10 km; endpoint and markers update in real time |
| 7 | Distance markers | `google.maps.Marker` at every 5 km along the line, labeled |
| 8 | Tap-to-inspect | Click/tap near line → snap to nearest point → info panel with coords + distance |
| 9 | Map auto-fit | On lock, animate camera to fit full line with padding |
| 10 | PWA manifest | `manifest.json` so the app can be added to the iOS home screen |

### 3.2 Nice-to-Have (Post-MVP)

| # | Feature | Description |
|---|---------|-------------|
| A | Compass accuracy indicator | Green/amber/red dot based on `webkitCompassAccuracy` |
| B | Manual bearing entry | Number input to type a bearing directly |
| C | Map type toggle | Switch between Hybrid and Roadmap |
| D | Tilt warning | Alert if device pitch > 30° (compass less reliable when tilted) |
| E | KML export | Generate and download a KML file for use in Google Earth |
| F | Draggable cursor on line | Drag a handle along the line; HUD shows live distance + coords |

---

## 4. Technical Architecture

### 4.1 File Structure

```
bearing-line/
├── index.html          # single page; all UI markup
├── style.css           # layout and theming
├── app.js              # application logic
├── geo.js              # bearing math (pure functions, no dependencies)
├── manifest.json       # PWA home-screen metadata
├── icons/
│   ├── icon-192.png    # PWA icon
│   └── icon-512.png    # PWA icon
└── SPEC.md
```

No build step, no `package.json`, no bundler. Files are served as-is.

### 4.2 Browser APIs Used

| API | Purpose | Notes |
|-----|---------|-------|
| `DeviceOrientationEvent` | Compass heading | `webkitCompassHeading` (iOS Safari); requires explicit permission since iOS 13 |
| `navigator.geolocation` | GPS position | `watchPosition` for continuous updates |
| Google Maps JavaScript API | Map, Polyline, Markers | Loaded via `<script>` tag with API key |
| `localStorage` | Persist last slider value | Optional quality-of-life |

### 4.3 Google Maps JavaScript API Setup

Load the API in `index.html`:
```html
<script
  src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&callback=initMap"
  async defer>
</script>
```

The `callback=initMap` parameter calls `initMap()` in `app.js` once the API is ready.

**Required Google Cloud configuration:**
- API enabled: **Maps JavaScript API**
- Key restriction type: **HTTP referrers**
- Allowed referrers: `localhost`, plus your hosting domain once deployed

### 4.4 Compass API (iOS Safari)

```javascript
// Step 1 — must be called from a user gesture (button tap)
async function enableCompass() {
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    const permission = await DeviceOrientationEvent.requestPermission();
    if (permission !== 'granted') return; // show error
  }
  window.addEventListener('deviceorientation', onOrientation);
}

// Step 2 — called on every compass update
function onOrientation(event) {
  // webkitCompassHeading: degrees clockwise from magnetic north [0, 360)
  // Available on iOS Safari; null on non-iOS or desktop
  const heading = event.webkitCompassHeading ?? null;
  if (heading === null) return;
  updateSmoothedHeading(heading);
}
```

**Note on true vs magnetic north:** `webkitCompassHeading` is magnetic north.
For distances ≤ 50 km the difference is typically 0–15° depending on location.
For a horizon-identification use case this is acceptable; a future version could
apply the local declination value from a free API (e.g. NOAA).

### 4.5 Compass Smoothing (EMA)

Naive averaging breaks at the 359°→0° wraparound. Use sin/cos components:

```javascript
let smoothSin = 0, smoothCos = 1;
const ALPHA = 0.15;

function updateSmoothedHeading(raw) {
  const rad = raw * Math.PI / 180;
  smoothSin = ALPHA * Math.sin(rad) + (1 - ALPHA) * smoothSin;
  smoothCos = ALPHA * Math.cos(rad) + (1 - ALPHA) * smoothCos;
  let heading = Math.atan2(smoothSin, smoothCos) * 180 / Math.PI;
  if (heading < 0) heading += 360;
  return heading;
}
```

### 4.6 Bearing Line Calculation

```javascript
const R = 6371000; // Earth radius in metres

function destinationPoint(lat1, lon1, bearingDeg, distanceM) {
  const d = distanceM / R;
  const b = bearingDeg * Math.PI / 180;
  const φ1 = lat1 * Math.PI / 180;
  const λ1 = lon1 * Math.PI / 180;

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(d) +
    Math.cos(φ1) * Math.sin(d) * Math.cos(b)
  );
  const λ2 = λ1 + Math.atan2(
    Math.sin(b) * Math.sin(d) * Math.cos(φ1),
    Math.cos(d) - Math.sin(φ1) * Math.sin(φ2)
  );

  return {
    lat: φ2 * 180 / Math.PI,
    lng: ((λ2 * 180 / Math.PI) + 540) % 360 - 180  // normalise to [-180, 180]
  };
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
```

### 4.7 Tap-to-Snap Logic

Google Maps JS fires `map.addListener('click', e => ...)` with a `LatLng`.
Project the click onto the line segment in lat/lon space:

```javascript
function snapToLine(tapLat, tapLng, originLat, originLng, endLat, endLng) {
  const ax = originLng, ay = originLat;
  const bx = endLng,    by = endLat;
  const px = tapLng,    py = tapLat;

  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const t = Math.max(0, Math.min(1,
    (apx * abx + apy * aby) / (abx * abx + aby * aby)
  ));

  const snappedLat = ay + t * aby;
  const snappedLng = ax + t * abx;
  const distFromTap = haversineDistance(tapLat, tapLng, snappedLat, snappedLng);

  if (distFromTap > 800) return null; // too far from line — ignore tap

  return {
    lat: snappedLat,
    lng: snappedLng,
    distFromOriginM: haversineDistance(originLat, originLng, snappedLat, snappedLng),
  };
}
```

---

## 5. UI Layout

```
┌─────────────────────────────────┐
│  ● GPS ±4 m   312.4°  NW  🔒    │  ← status bar
├─────────────────────────────────┤
│                                 │
│                                 │
│    GOOGLE MAPS (hybrid)         │  ~65% of viewport height
│    bearing polyline drawn here  │
│                                 │
│                                 │
├─────────────────────────────────┤
│  Line length:  ●━━━━━━━━━━●     │  ← slider, 1–50 km
│  1 km                   50 km  │
│                                 │
│  [ LOCK BEARING ]               │  ← becomes [ UNLOCK ] when locked
└─────────────────────────────────┘

  ── first launch overlay ──────────────────
  │  Bearing Line                          │
  │                                        │
  │  Tap below to allow compass access.    │
  │                                        │
  │      [ Enable Compass ]                │
  └────────────────────────────────────────┘

  ── tap-to-inspect panel (slides up) ─────
  │  41.892300° N                          │
  │  87.654100° W                          │
  │  7.3 km from your location             │
  │  [ Open in Google Maps ]    [ × ]      │
  └────────────────────────────────────────┘
```

**App states:**

| State | Behaviour |
|-------|-----------|
| First load | Compass permission overlay shown; map not yet interactive |
| Permission denied | Error message; app cannot function without compass |
| Unlocked (default) | Heading and line update live; map follows user position |
| Locked | Line frozen; map freely pannable; slider adjusts length; lock icon shown |
| No GPS | Banner: "Waiting for GPS…"; Lock button disabled |
| Tap near line (locked only) | Snap info panel slides up from bottom |

---

## 6. State Model (JavaScript)

All mutable state lives in a single plain object in `app.js`:

```javascript
const state = {
  // sensors
  compassGranted:   false,
  liveHeading:      null,   // smoothed, degrees
  lockedHeading:    null,
  isLocked:         false,
  currentLat:       null,
  currentLng:       null,
  gpsAccuracyM:     null,

  // user settings
  maxDistanceKm:    10,

  // computed (derived on every render)
  // endpointLat / endpointLng calculated from above fields
};
```

A single `render()` function reads `state` and updates the DOM and map objects.
Called after every state mutation. Keeps logic and presentation cleanly separated.

---

## 7. Map Object Lifecycle

```
initMap()  ← called by Google Maps API callback
  └─ create google.maps.Map  (MapTypeId.HYBRID)
  └─ create google.maps.Polyline  (hidden initially)
  └─ attach map click listener → snapToLine → showInfoPanel()
  └─ start geolocation watch

render()   ← called on every state change
  └─ update heading display text
  └─ update lock button label / style
  └─ if (origin + heading exist):
       └─ calculate endpoint via destinationPoint()
       └─ update Polyline path [origin, endpoint]
       └─ rebuild distance Markers (clear old, add new at 5 km steps)
       └─ if just locked: fitBounds(origin, endpoint)
```

Reusing a single `Polyline` instance (updating its path) is more efficient than
destroying and recreating it on every heading change.

---

## 8. PWA Manifest

`manifest.json`:
```json
{
  "name": "Bearing Line",
  "short_name": "Bearing",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1a1a1a",
  "theme_color": "#1a1a1a",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

`display: standalone` hides the Safari browser chrome when launched from the
home screen, giving it a full-screen app feel.

---

## 9. Hosting

**GitHub Pages (recommended):** free, HTTPS by default, trivially easy to deploy.

```bash
# one-time setup
git init
git remote add origin https://github.com/YOURNAME/bearing-line.git

# deploy
git add .
git commit -m "deploy"
git push origin main
# → live at https://YOURNAME.github.io/bearing-line/
```

Add `https://YOURNAME.github.io/*` to the Google Maps API key's allowed HTTP
referrers once you know the URL.

---

## 10. Accuracy Considerations

| Source of error | Mitigation |
|-----------------|-----------|
| Compass jitter | EMA smoothing (α = 0.15); lock before relying on reading |
| Magnetic vs true north | Acceptable for ≤ 50 km; future: apply NOAA declination |
| GPS accuracy | Show accuracy radius in status bar; origin updates until locked |
| Earth curvature | Spherical Haversine; error < 0.1% at 50 km |
| Device tilt | Compass is most accurate held flat; tilt warning post-MVP |

---

## 11. Development Checklist

### Setup
- [ ] Confirm Google Cloud: **Maps JavaScript API** enabled
- [ ] Confirm API key restriction changed to **HTTP referrers**
- [ ] Add `localhost` to allowed referrers for local dev
- [ ] Create `icons/icon-192.png` and `icons/icon-512.png`

### Phase 1 — Shell
- [ ] `index.html`: page structure, script/style links, Google Maps script tag
- [ ] `style.css`: layout, dark theme, responsive
- [ ] `manifest.json`: PWA metadata

### Phase 2 — Logic
- [ ] `geo.js`: `destinationPoint()`, `haversineDistance()`, `snapToLine()`
- [ ] `app.js`: state object, `render()` function skeleton

### Phase 3 — Sensors
- [ ] Compass permission button → `DeviceOrientationEvent.requestPermission()`
- [ ] `deviceorientation` listener → EMA smoothing → `state.liveHeading`
- [ ] `navigator.geolocation.watchPosition` → `state.currentLat/Lng`

### Phase 4 — Map
- [ ] `initMap()`: create Map, Polyline, attach click listener
- [ ] `render()`: update Polyline path, rebuild distance Markers
- [ ] Lock → `fitBounds()` camera animation
- [ ] Map click → `snapToLine()` → info panel

### Phase 5 — Polish
- [ ] PWA icons
- [ ] Add to home screen test on real iPhone
- [ ] GitHub Pages deploy + update API key referrer

---

## 12. Out of Scope (v1.0)

- Service worker / offline mode
- Android (works in Chrome on Android with minor JS adjustments — low effort later)
- True-north correction (magnetic declination)
- Multiple simultaneous lines
- User accounts or saved lines
