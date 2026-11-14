import { Bounds, centerOf, heightMeters, widthMeters } from './geo';
import {
  LonLatRing,
  circleRing,
  heartRing,
  rectangleRing,
  boundsFromCenter,
} from './shapes';

export type PrintMode = 'fit' | 'scale';
export type CutShape = 'none' | 'circle' | 'heart' | 'rect';

export interface PrintSize {
  /** East–west size used to build the model (mm). */
  widthMm: number;
  /** North–south size used to build the model (mm). */
  depthMm: number;
  /** Full model size at the chosen scale before bed crop. */
  naturalWidthMm: number;
  naturalDepthMm: number;
  /** Resulting map scale (real/model), e.g. 500 for 1:500. */
  scaleRatio: number;
  bedWidthMm: number;
  bedDepthMm: number;
  mode: PrintMode;
  /** True when at this scale the full zone is larger than the bed. */
  overflow: boolean;
  /** Center crop of the zone that fits in the bed at this scale. */
  cropBounds: Bounds | null;
  note: string;
}

export function readPrintMode(): PrintMode {
  const scale = document.getElementById('print-mode-scale') as HTMLInputElement | null;
  return scale?.checked ? 'scale' : 'fit';
}

export function readCutShape(): CutShape {
  const active = document.querySelector<HTMLButtonElement>('.cut-btn.active');
  const v = active?.dataset.cut;
  if (v === 'circle' || v === 'heart' || v === 'rect' || v === 'none') return v;
  return 'none';
}

/** Ground window (m) that fits in the bed at scale 1:N. */
export function bedGroundMeters(bedWmm: number, bedDmm: number, scaleRatio: number): {
  widthM: number;
  depthM: number;
} {
  return {
    widthM: (bedWmm / 1000) * scaleRatio,
    depthM: (bedDmm / 1000) * scaleRatio,
  };
}

export function centerCropBounds(bounds: Bounds, cropWidthM: number, cropDepthM: number): Bounds {
  const c = centerOf(bounds);
  const w = Math.min(widthMeters(bounds), cropWidthM);
  const h = Math.min(heightMeters(bounds), cropDepthM);
  return boundsFromCenter(c.lat, c.lon, w, h);
}

/**
 * Compute print size from the selected ground bounds and the UI.
 * In scale mode, overflow no longer errors: the center that fits in the bed
 * is kept, the surplus is preview-dimmed and cut on « Réorganiser ».
 */
export function resolvePrintSize(bounds: Bounds): PrintSize {
  const bedW = clamp(num('print-w-mm', 200), 20, 400);
  const bedD = clamp(num('print-d-mm', 200), 20, 400);
  const wM = widthMeters(bounds);
  const hM = heightMeters(bounds);
  const mode = readPrintMode();

  if (mode === 'fit') {
    const scaleW = (wM * 1000) / bedW;
    const scaleD = (hM * 1000) / bedD;
    const scaleRatio = Math.max(scaleW, scaleD);
    const widthMm = (wM * 1000) / scaleRatio;
    const depthMm = (hM * 1000) / scaleRatio;
    return {
      widthMm,
      depthMm,
      naturalWidthMm: widthMm,
      naturalDepthMm: depthMm,
      scaleRatio,
      bedWidthMm: bedW,
      bedDepthMm: bedD,
      mode,
      overflow: false,
      cropBounds: null,
      note: `Zone entière → ${fmt1(widthMm)} × ${fmt1(depthMm)} mm (1:${fmtScale(scaleRatio)})`,
    };
  }

  const scaleRatio = Math.max(50, num('opt-scale', 500));
  const naturalWidthMm = (wM * 1000) / scaleRatio;
  const naturalDepthMm = (hM * 1000) / scaleRatio;
  const overflow = naturalWidthMm > bedW + 0.05 || naturalDepthMm > bedD + 0.05;

  if (!overflow) {
    return {
      widthMm: naturalWidthMm,
      depthMm: naturalDepthMm,
      naturalWidthMm,
      naturalDepthMm,
      scaleRatio,
      bedWidthMm: bedW,
      bedDepthMm: bedD,
      mode,
      overflow: false,
      cropBounds: null,
      note: `1:${fmtScale(scaleRatio)} → ${fmt1(naturalWidthMm)} × ${fmt1(naturalDepthMm)} mm dans ${bedW} × ${bedD} mm`,
    };
  }

  const { widthM, depthM } = bedGroundMeters(bedW, bedD, scaleRatio);
  const cropBounds = centerCropBounds(bounds, widthM, depthM);
  return {
    // Preview builds the full zone at true scale; rebuild uses bed size + crop.
    widthMm: naturalWidthMm,
    depthMm: naturalDepthMm,
    naturalWidthMm,
    naturalDepthMm,
    scaleRatio,
    bedWidthMm: bedW,
    bedDepthMm: bedD,
    mode,
    overflow: true,
    cropBounds,
    note:
      `1:${fmtScale(scaleRatio)} : zone ${fmt1(naturalWidthMm)} × ${fmt1(naturalDepthMm)} mm → ` +
      `plateau ${bedW} × ${bedD} mm (centre ~${Math.round(widthM)} × ${Math.round(depthM)} m). ` +
      `Hors plateau assombri — « Réorganiser » coupe le surplus.`,
  };
}

/**
 * Build a cut footprint centered on the selection.
 * `none` / full square → rectangular ring of the bounds.
 */
export function cutFootprint(bounds: Bounds, shape: CutShape): LonLatRing {
  const c = centerOf(bounds);
  const side = Math.min(widthMeters(bounds), heightMeters(bounds));

  switch (shape) {
    case 'circle':
      return circleRing(c.lat, c.lon, side / 2);
    case 'heart':
      return heartRing(c.lat, c.lon, side);
    case 'rect': {
      const wPct = clamp(num('cut-rect-w', 100), 20, 100) / 100;
      const dPct = clamp(num('cut-rect-d', 70), 20, 100) / 100;
      const wM = widthMeters(bounds) * wPct;
      const hM = heightMeters(bounds) * dPct;
      return rectangleRing(boundsFromCenter(c.lat, c.lon, wM, hM));
    }
    case 'none':
    default:
      return rectangleRing(bounds);
  }
}

export function updatePrintHint(bounds: Bounds | null): void {
  const hint = document.getElementById('print-hint');
  if (!hint) return;
  if (!bounds) {
    hint.textContent = 'Générez d’abord un modèle.';
    return;
  }
  try {
    const size = resolvePrintSize(bounds);
    hint.textContent = size.note;
  } catch (err) {
    hint.textContent = err instanceof Error ? err.message : 'Réglages d’impression invalides.';
  }
}

function num(id: string, fallback: number): number {
  const el = document.getElementById(id) as HTMLInputElement | null;
  const v = el ? Number(el.value) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function fmt1(mm: number): string {
  return mm < 10 ? mm.toFixed(1) : String(Math.round(mm));
}

function fmtScale(ratio: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 3 }).format(ratio);
}
