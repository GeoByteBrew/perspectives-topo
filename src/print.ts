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
  /** East–west size of the printed model in mm. */
  widthMm: number;
  /** North–south size of the printed model in mm. */
  depthMm: number;
  /** Resulting map scale (real/model), e.g. 500 for 1:500. */
  scaleRatio: number;
  /** Bed requested by the user (may be larger than the model in scale mode). */
  bedWidthMm: number;
  bedDepthMm: number;
  mode: PrintMode;
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

/** Compute print size from the selected ground bounds and the UI. */
export function resolvePrintSize(bounds: Bounds): PrintSize {
  const bedW = clamp(num('print-w-mm', 200), 20, 400);
  const bedD = clamp(num('print-d-mm', 200), 20, 400);
  const wM = widthMeters(bounds);
  const hM = heightMeters(bounds);
  const mode = readPrintMode();

  if (mode === 'fit') {
    // Uniform scale so the whole area fits inside the bed.
    const scaleW = (wM * 1000) / bedW;
    const scaleD = (hM * 1000) / bedD;
    const scaleRatio = Math.max(scaleW, scaleD);
    const widthMm = (wM * 1000) / scaleRatio;
    const depthMm = (hM * 1000) / scaleRatio;
    return {
      widthMm,
      depthMm,
      scaleRatio,
      bedWidthMm: bedW,
      bedDepthMm: bedD,
      mode,
      note: `Zone entière → ${fmt1(widthMm)} × ${fmt1(depthMm)} mm (1:${fmtScale(scaleRatio)})`,
    };
  }

  const scaleRatio = Math.max(50, num('opt-scale', 500));
  const widthMm = (wM * 1000) / scaleRatio;
  const depthMm = (hM * 1000) / scaleRatio;
  if (widthMm > bedW + 0.05 || depthMm > bedD + 0.05) {
    throw new Error(
      `À 1:${fmtScale(scaleRatio)} le modèle ferait ${fmt1(widthMm)} × ${fmt1(depthMm)} mm — ` +
        `plus grand que le plateau ${bedW} × ${bedD} mm. Augmentez l’échelle (N) ou le plateau.`,
    );
  }
  return {
    widthMm,
    depthMm,
    scaleRatio,
    bedWidthMm: bedW,
    bedDepthMm: bedD,
    mode,
    note: `1:${fmtScale(scaleRatio)} → ${fmt1(widthMm)} × ${fmt1(depthMm)} mm dans ${bedW} × ${bedD} mm`,
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
