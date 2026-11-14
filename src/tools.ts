import type { MapController } from './map';

type PendingPlace =
  | { kind: 'rect'; w: number; h: number }
  | { kind: 'circle'; r: number }
  | { kind: 'triangle'; size: number }
  | { kind: 'heart'; size: number };

/** Wire the left selection + print panel to the map and print inputs. */
export function setupTools(
  map: MapController,
  opts: {
    onHint: (text: string) => void;
    syncPrintWidth: (widthMm: number) => void;
  },
): void {
  const num = (id: string) => Number((document.getElementById(id) as HTMLInputElement).value);
  const clickBtn = document.getElementById('btn-click-place') as HTMLButtonElement;
  let clickArmed = false;
  let pending: PendingPlace | null = null;

  const disarmClick = () => {
    clickArmed = false;
    clickBtn.classList.remove('active');
    map.armClickPlace(null);
  };

  const placePending = (lat?: number, lon?: number) => {
    if (!pending) return;
    const center = lat !== undefined && lon !== undefined ? { lat, lon } : undefined;
    switch (pending.kind) {
      case 'rect':
        map.placeRectangle(pending.w, pending.h, center);
        break;
      case 'circle':
        map.placeCircle(pending.r, center);
        break;
      case 'triangle':
        map.placeTriangle(pending.size, center);
        break;
      case 'heart':
        map.placeHeart(pending.size, center);
        break;
    }
  };

  const runOrArm = (next: PendingPlace) => {
    pending = next;
    if (clickArmed) {
      opts.onHint('Cliquez sur la carte pour placer la forme');
      map.armClickPlace((lat, lon) => {
        placePending(lat, lon);
        disarmClick();
        opts.onHint('Zone placée — vous pouvez générer le modèle');
      });
      return;
    }
    placePending();
    opts.onHint('Zone placée au centre — déplacez-la ou régénérez');
  };

  document.querySelectorAll<HTMLButtonElement>('.preset[data-place="square"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = Number(btn.dataset.m);
      runOrArm({ kind: 'rect', w: m, h: m });
    });
  });

  document.getElementById('btn-place-rect')!.addEventListener('click', () => {
    runOrArm({ kind: 'rect', w: num('sel-width-m'), h: num('sel-height-m') });
  });
  document.getElementById('btn-place-circle')!.addEventListener('click', () => {
    runOrArm({ kind: 'circle', r: num('sel-radius-m') });
  });
  document.getElementById('btn-place-triangle')!.addEventListener('click', () => {
    runOrArm({ kind: 'triangle', size: num('sel-shape-m') });
  });
  document.getElementById('btn-place-heart')!.addEventListener('click', () => {
    runOrArm({ kind: 'heart', size: num('sel-shape-m') });
  });

  clickBtn.addEventListener('click', () => {
    clickArmed = !clickArmed;
    clickBtn.classList.toggle('active', clickArmed);
    if (!clickArmed) {
      map.armClickPlace(null);
      opts.onHint('Choisissez une zone à gauche, ou dessinez un rectangle');
      return;
    }
    opts.onHint('Choisissez une forme, puis cliquez sur la carte');
    if (pending) {
      map.armClickPlace((lat, lon) => {
        placePending(lat, lon);
        disarmClick();
        opts.onHint('Zone placée — vous pouvez générer le modèle');
      });
    }
  });

  document.getElementById('btn-clear-sel')!.addEventListener('click', () => {
    map.clearSelection();
    disarmClick();
    opts.onHint('Choisissez une zone à gauche, ou dessinez un rectangle');
  });

  const modeSize = document.getElementById('print-mode-size') as HTMLInputElement;
  const modeScale = document.getElementById('print-mode-scale') as HTMLInputElement;
  const sizeFields = document.getElementById('print-size-fields')!;
  const scaleFields = document.getElementById('print-scale-fields')!;
  const scaleHint = document.getElementById('print-scale-hint')!;

  const refreshPrintUi = () => {
    const byScale = modeScale.checked;
    sizeFields.hidden = byScale;
    scaleFields.hidden = !byScale;
    scaleHint.hidden = !byScale;
    if (byScale) {
      const scale = num('opt-scale') || 200;
      const sideMm = num('opt-print-side') || 200;
      const groundM = (sideMm / 1000) * scale;
      scaleHint.textContent =
        `1:${scale} sur ${sideMm} mm → environ ${Math.round(groundM)} × ${Math.round(groundM)} m au sol.`;
      opts.syncPrintWidth(sideMm);
    }
  };

  modeSize.addEventListener('change', refreshPrintUi);
  modeScale.addEventListener('change', refreshPrintUi);
  document.getElementById('opt-scale')!.addEventListener('input', refreshPrintUi);
  document.getElementById('opt-print-side')!.addEventListener('input', refreshPrintUi);

  document.getElementById('btn-apply-scale')!.addEventListener('click', () => {
    const scale = num('opt-scale') || 200;
    const sideMm = num('opt-print-side') || 200;
    const groundM = (sideMm / 1000) * scale;
    if (groundM < 40) {
      opts.onHint('Zone trop petite — augmentez le côté ou l’échelle');
      return;
    }
    if (groundM > 6000) {
      opts.onHint('Zone trop grande pour les détails OSM — réduisez côté ou échelle');
      return;
    }
    opts.syncPrintWidth(sideMm);
    runOrArm({ kind: 'rect', w: groundM, h: groundM });
    refreshPrintUi();
  });

  refreshPrintUi();
}

/** Resolve the print width (mm) from the active impression mode. */
export function resolvePrintWidthMm(groundWidthM: number): number {
  const byScale = (document.getElementById('print-mode-scale') as HTMLInputElement).checked;
  if (!byScale) {
    return Number((document.getElementById('opt-width') as HTMLInputElement).value) || 120;
  }
  const scale = Number((document.getElementById('opt-scale') as HTMLInputElement).value) || 200;
  const side = Number((document.getElementById('opt-print-side') as HTMLInputElement).value) || 200;
  // Prefer the explicit print side; fall back to ground/scale if side missing.
  if (side > 0) return side;
  return (groundWidthM * 1000) / scale;
}
