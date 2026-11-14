import type { LonLatRing } from '../shapes';
import type { TerrainGrid } from './terrain';

/** Ray-casting point-in-polygon. Ring may be open or closed. */
export function pointInRing(lon: number, lat: number, ring: LonLatRing): boolean {
  const n = ring.length;
  if (n < 3) return false;
  const last = ring[n - 1];
  const closed = last[0] === ring[0][0] && last[1] === ring[0][1];
  const count = closed ? n - 1 : n;
  let inside = false;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Cell mask: 1 if the cell center (between grid vertices) lies inside the footprint.
 * Size = (cols-1) * (rows-1).
 */
export function cellMaskFromFootprint(grid: TerrainGrid, ring: LonLatRing): Uint8Array {
  const cellsX = grid.cols - 1;
  const cellsY = grid.rows - 1;
  const mask = new Uint8Array(cellsX * cellsY);
  for (let j = 0; j < cellsY; j++) {
    for (let i = 0; i < cellsX; i++) {
      const lon = (grid.lons[i] + grid.lons[i + 1]) / 2;
      const lat = (grid.lats[j] + grid.lats[j + 1]) / 2;
      if (pointInRing(lon, lat, ring)) mask[j * cellsX + i] = 1;
    }
  }
  return mask;
}

/**
 * Supersampled mask of cells *outside* the footprint (for overlay exclude).
 * Size = (cols-1)*SS * (rows-1)*SS.
 */
export function outsideFootprintSubmask(grid: TerrainGrid, ring: LonLatRing, ss: number): Uint8Array {
  const cellsX = grid.cols - 1;
  const cellsY = grid.rows - 1;
  const subCols = cellsX * ss;
  const subRows = cellsY * ss;
  const mask = new Uint8Array(subCols * subRows);
  const lon0 = grid.lons[0];
  const lat0 = grid.lats[0];
  const lonSpan = grid.lons[grid.cols - 1] - lon0;
  const latSpan = grid.lats[grid.rows - 1] - lat0;
  for (let j = 0; j < subRows; j++) {
    for (let i = 0; i < subCols; i++) {
      const lon = lon0 + ((i + 0.5) / subCols) * lonSpan;
      const lat = lat0 + ((j + 0.5) / subRows) * latSpan;
      if (!pointInRing(lon, lat, ring)) mask[j * subCols + i] = 1;
    }
  }
  return mask;
}
