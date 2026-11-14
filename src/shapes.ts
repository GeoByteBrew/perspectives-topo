import { Bounds, metersPerDegLon } from './geo';

/** Lon/lat ring (closed: first point repeated at end). */
export type LonLatRing = Array<[number, number]>;

export function boundsFromCenter(
  lat: number,
  lon: number,
  widthM: number,
  heightM: number,
): Bounds {
  const halfW = widthM / 2;
  const halfH = heightM / 2;
  const dLon = halfW / metersPerDegLon(lat);
  const dLat = halfH / 110574;
  return {
    west: lon - dLon,
    east: lon + dLon,
    south: lat - dLat,
    north: lat + dLat,
  };
}

export function rectangleRing(b: Bounds): LonLatRing {
  return [
    [b.west, b.south],
    [b.east, b.south],
    [b.east, b.north],
    [b.west, b.north],
    [b.west, b.south],
  ];
}

/** Circle approximated as a regular polygon; `radiusM` in meters. */
export function circleRing(lat: number, lon: number, radiusM: number, steps = 64): LonLatRing {
  const ring: LonLatRing = [];
  const mLon = metersPerDegLon(lat);
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([lon + (Math.cos(a) * radiusM) / mLon, lat + (Math.sin(a) * radiusM) / 110574]);
  }
  return ring;
}

/** Equilateral triangle centered on (lat, lon); `sizeM` = side length. */
export function triangleRing(lat: number, lon: number, sizeM: number): LonLatRing {
  const mLon = metersPerDegLon(lat);
  const h = (Math.sqrt(3) / 2) * sizeM;
  // Centroid is at 2/3 of the height from a vertex.
  const points: Array<[number, number]> = [
    [0, (2 / 3) * h],
    [-sizeM / 2, -(1 / 3) * h],
    [sizeM / 2, -(1 / 3) * h],
  ];
  const ring: LonLatRing = points.map(([x, y]) => [lon + x / mLon, lat + y / 110574]);
  ring.push(ring[0]);
  return ring;
}

/**
 * Heart outline scaled so its bounding box is roughly `sizeM` × `sizeM`.
 * Parametric heart, then normalized to the requested meters.
 */
export function heartRing(lat: number, lon: number, sizeM: number, steps = 72): LonLatRing {
  const raw: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    // Classic parametric heart in abstract units.
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    raw.push([x, y]);
  }
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of raw) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const mLon = metersPerDegLon(lat);
  const ring: LonLatRing = raw.map(([x, y]) => {
    const mx = ((x - cx) / spanX) * sizeM;
    const my = ((y - cy) / spanY) * sizeM;
    return [lon + mx / mLon, lat + my / 110574];
  });
  return ring;
}

export function ringBounds(ring: LonLatRing): Bounds {
  let west = Infinity,
    east = -Infinity,
    south = Infinity,
    north = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, east, south, north };
}
