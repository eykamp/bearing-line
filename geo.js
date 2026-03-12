// geo.js — pure geometry functions, no dependencies

const EARTH_RADIUS_M = 6371000;

/**
 * Returns the point reached from (lat1, lng1) by travelling distanceM metres
 * along bearingDeg (degrees clockwise from north).
 * Returns { lat, lng }.
 */
function destinationPoint(lat1, lng1, bearingDeg, distanceM) {
  const d  = distanceM / EARTH_RADIUS_M;
  const b  = bearingDeg * Math.PI / 180;
  const φ1 = lat1 * Math.PI / 180;
  const λ1 = lng1 * Math.PI / 180;

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
    lng: ((λ2 * 180 / Math.PI) + 540) % 360 - 180,  // normalise to [-180, 180]
  };
}

/**
 * Haversine distance in metres between two lat/lng points.
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Projects (tapLat, tapLng) onto the line segment origin→endpoint.
 * Returns { lat, lng, distFromOriginM } if the tap is within thresholdM metres
 * of the line, otherwise returns null.
 */
function snapToLine(tapLat, tapLng, originLat, originLng, endLat, endLng, thresholdM = 800) {
  const ax = originLng, ay = originLat;
  const bx = endLng,    by = endLat;
  const px = tapLng,    py = tapLat;

  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return null;

  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq));
  const snappedLat = ay + t * aby;
  const snappedLng = ax + t * abx;

  const distFromTap = haversineDistance(tapLat, tapLng, snappedLat, snappedLng);
  if (distFromTap > thresholdM) return null;

  return {
    lat: snappedLat,
    lng: snappedLng,
    distFromOriginM: haversineDistance(originLat, originLng, snappedLat, snappedLng),
  };
}

/**
 * Cardinal direction label for a heading in degrees.
 */
function toCardinal(heading) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(heading / 45) % 8];
}
