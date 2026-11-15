import type { Position } from 'geojson';
import { Bounds, centerOf, heightMeters, widthMeters } from './geo';
import { boundsFromCenter } from './shapes';

export type GpxTrack = Position[]; // [lon, lat][]

/** Parse a GPX 1.0 / 1.1 document into track and route polylines. */
export function parseGpx(xmlText: string): GpxTrack[] {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Fichier GPX invalide.');
  }

  const tracks: GpxTrack[] = [];

  const collect = (parent: Element, pointTag: string) => {
    const pts: Position[] = [];
    for (const el of parent.querySelectorAll(pointTag)) {
      const lat = Number(el.getAttribute('lat'));
      const lon = Number(el.getAttribute('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      pts.push([lon, lat]);
    }
    if (pts.length >= 2) tracks.push(pts);
  };

  for (const trk of doc.getElementsByTagName('trk')) {
    const segs = trk.getElementsByTagName('trkseg');
    if (segs.length === 0) {
      collect(trk, 'trkpt');
    } else {
      for (const seg of segs) collect(seg, 'trkpt');
    }
  }

  for (const rte of doc.getElementsByTagName('rte')) {
    collect(rte, 'rtept');
  }

  if (tracks.length === 0) {
    throw new Error('Aucune trace trouvée dans le GPX (trk / rte).');
  }
  return tracks;
}

export function tracksBounds(tracks: GpxTrack[]): Bounds {
  let west = Infinity,
    east = -Infinity,
    south = Infinity,
    north = -Infinity;
  for (const track of tracks) {
    for (const [lon, lat] of track) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  if (!Number.isFinite(west)) {
    throw new Error('Trace GPX vide.');
  }
  return { west, east, south, north };
}

/**
 * Square zone covering the track with a margin (min 100 m / 10%).
 * Capped at 20 km for the relief-only mode.
 */
export function squareAroundTracks(
  tracks: GpxTrack[],
  maxSideM = 20000,
): {
  center: { lat: number; lon: number };
  sideM: number;
  bounds: Bounds;
} {
  const b = tracksBounds(tracks);
  const w = widthMeters(b);
  const h = heightMeters(b);
  const pad = Math.max(100, 0.1 * Math.max(w, h));
  let side = Math.max(w, h) + 2 * pad;
  side = Math.min(maxSideM, Math.max(40, side));
  const c = centerOf(b);
  return {
    center: c,
    sideM: side,
    bounds: boundsFromCenter(c.lat, c.lon, side, side),
  };
}
