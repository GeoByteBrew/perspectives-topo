import type { MapController } from './map';
import { heightMeters, widthMeters, type Bounds } from './geo';
import { readCutShape, readPrintMode, updatePrintHint } from './print';

/** Wire étape 1 (zone carrée) + étapes 2–3 (impression / découpe) UI. */
export function setupTools(
  map: MapController,
  opts: {
    onHint: (text: string) => void;
    getBounds: () => Bounds | null;
    onPrintUiChange: () => void;
  },
): void {
  const clickBtn = document.getElementById('btn-click-place') as HTMLButtonElement;
  const zoneSummary = document.getElementById('zone-summary')!;
  let clickArmed = false;
  let pendingSide = 300;

  const sideM = () => {
    const v = Number((document.getElementById('sel-side-m') as HTMLInputElement).value);
    return Number.isFinite(v) && v >= 40 ? v : 300;
  };

  const disarmClick = () => {
    clickArmed = false;
    clickBtn.classList.remove('active');
    map.armClickPlace(null);
  };

  const placeSquare = (m: number, lat?: number, lon?: number) => {
    pendingSide = m;
    (document.getElementById('sel-side-m') as HTMLInputElement).value = String(Math.round(m));
    const center = lat !== undefined && lon !== undefined ? { lat, lon } : undefined;
    map.placeRectangle(m, m, center);
    opts.onHint('Carré placé — générez le modèle');
  };

  const runOrArm = (m: number) => {
    pendingSide = m;
    if (clickArmed) {
      opts.onHint('Cliquez sur la carte pour placer le carré');
      map.armClickPlace((lat, lon) => {
        placeSquare(pendingSide, lat, lon);
        disarmClick();
      });
      return;
    }
    placeSquare(m);
  };

  document.querySelectorAll<HTMLButtonElement>('.preset[data-place="square"]').forEach((btn) => {
    btn.addEventListener('click', () => runOrArm(Number(btn.dataset.m)));
  });

  document.getElementById('btn-place-square')!.addEventListener('click', () => runOrArm(sideM()));

  clickBtn.addEventListener('click', () => {
    clickArmed = !clickArmed;
    clickBtn.classList.toggle('active', clickArmed);
    if (!clickArmed) {
      map.armClickPlace(null);
      opts.onHint('Étape 1 — placez un carré sur la carte');
      return;
    }
    pendingSide = sideM();
    opts.onHint('Cliquez sur la carte pour placer le carré');
    map.armClickPlace((lat, lon) => {
      placeSquare(pendingSide, lat, lon);
      disarmClick();
    });
  });

  document.getElementById('btn-clear-sel')!.addEventListener('click', () => {
    map.clearSelection();
    disarmClick();
    zoneSummary.textContent = 'Aucun carré sélectionné.';
    opts.onHint('Étape 1 — placez un carré sur la carte');
    updatePrintHint(null);
  });

  // Print mode UI
  const scaleRow = document.getElementById('print-scale-row')!;
  const refreshPrintMode = () => {
    scaleRow.hidden = readPrintMode() !== 'scale';
    updatePrintHint(opts.getBounds());
    opts.onPrintUiChange();
  };
  document.getElementById('print-mode-fit')!.addEventListener('change', refreshPrintMode);
  document.getElementById('print-mode-scale')!.addEventListener('change', refreshPrintMode);
  for (const id of ['print-w-mm', 'print-d-mm', 'opt-scale']) {
    document.getElementById(id)!.addEventListener('input', () => {
      updatePrintHint(opts.getBounds());
      opts.onPrintUiChange();
    });
  }

  // Cut shape UI
  const cutRectRow = document.getElementById('cut-rect-row')!;
  document.querySelectorAll<HTMLButtonElement>('.cut-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cut-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      cutRectRow.hidden = readCutShape() !== 'rect';
      opts.onPrintUiChange();
    });
  });
  for (const id of ['cut-rect-w', 'cut-rect-d']) {
    document.getElementById(id)!.addEventListener('input', () => opts.onPrintUiChange());
  }

  refreshPrintMode();
}

export function formatZoneSummary(bounds: Bounds): string {
  const w = Math.round(widthMeters(bounds));
  const h = Math.round(heightMeters(bounds));
  return `Zone ${w} × ${h} m`;
}
