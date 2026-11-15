import './style.css';
import * as THREE from 'three';
import { Bounds, ModelSpace, widthMeters, heightMeters } from './geo';
import { loadDem, type Dem } from './elevation';
import { fetchMapFeatures, MapFeatures } from './overpass';
import { sampleGrid, buildTerrain, buildBase } from './geometry/terrain';
import { buildBuildings } from './geometry/buildings';
import { cellMaskFromFootprint, outsideFootprintSubmask } from './geometry/footprint';
import {
  buildPolygonOverlay,
  buildRoadOverlay,
  mergeSoups,
  ROAD_STYLE,
  WATER_STYLE,
  GREEN_STYLE,
} from './geometry/overlays';
import { Preview, type ModelMeta } from './preview';
import { downloadStl } from './export/stl';
import { downloadThreeMf, NamedBody } from './export/threeMf';
import { createMap, setupSearch } from './map';
import { cutFootprint, readCutShape, resolvePrintSize, updatePrintHint } from './print';
import { formatZoneSummary, setupTools } from './tools';

const COLORS = {
  base: 0x3d3a36,
  terrain: 0x9a9080,
  buildings: 0xe8e4da,
  roads: 0x4f4a45,
  water: 0x4f81ad,
  green: 0x7aa05e,
};

const el = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;

const btnGenerate = el<HTMLButtonElement>('#btn-generate');
const btnRebuild = el<HTMLButtonElement>('#btn-rebuild');
const btnDownload = el<HTMLButtonElement>('#btn-download');
const btnDownload3mf = el<HTMLButtonElement>('#btn-download-3mf');
const status = el<HTMLSpanElement>('#status');
const mapHint = el<HTMLDivElement>('#map-hint');
const previewEmpty = el<HTMLDivElement>('#preview-empty');
const previewMeta = el<HTMLElement>('#preview-meta');
const previewMetaScale = el<HTMLElement>('#preview-meta-scale');
const previewMetaDims = el<HTMLElement>('#preview-meta-dims');
const previewMetaGround = el<HTMLElement>('#preview-meta-ground');
const studioPanel = el<HTMLElement>('#studio-panel');
const zoneSummary = el<HTMLElement>('#zone-summary');
const exportHint = el<HTMLElement>('#export-hint');

let selection: Bounds | null = null;
let exportBodies: NamedBody[] = [];
let generating = false;
let hasModel = false;

/** Cache DEM/OSM for the current bounds so « Réorganiser » is fast. */
let cacheKey: string | null = null;
let cachedDem: Dem | null = null;
let cachedFeatures: MapFeatures | null = null;

const mapController = createMap(el('#map'), (bounds) => {
  selection = bounds;
  btnGenerate.disabled = bounds === null || generating;
  if (bounds) {
    mapHint.hidden = true;
    zoneSummary.textContent = formatZoneSummary(bounds);
    updatePrintHint(bounds);
  } else {
    mapHint.hidden = false;
    mapHint.textContent = 'Étape 1 — placez un carré sur la carte';
    zoneSummary.textContent = 'Aucun carré sélectionné.';
  }
});
setupSearch(mapController);
setupTools(mapController, {
  onHint: (text) => {
    mapHint.hidden = false;
    mapHint.textContent = text;
  },
  getBounds: () => selection,
  onPrintUiChange: () => {
    if (hasModel) {
      exportHint.textContent = 'Réglages modifiés — cliquez « Réorganiser le modèle ».';
      btnDownload.disabled = true;
      btnDownload3mf.disabled = true;
    }
  },
});

const preview = new Preview(el<HTMLCanvasElement>('#preview'));

function setStatus(text: string): void {
  status.textContent = text;
}

const checked = (id: string): boolean => el<HTMLInputElement>(id).checked;

function boundsKey(b: Bounds): string {
  return [b.west, b.south, b.east, b.north].map((x) => x.toFixed(6)).join(',');
}

async function generate(mode: 'first' | 'rebuild'): Promise<void> {
  if (!selection || generating) return;
  const bounds = selection;
  generating = true;
  btnGenerate.disabled = true;
  btnRebuild.disabled = true;
  btnDownload.disabled = true;
  btnDownload3mf.disabled = true;

  try {
    const zFactor = Number(el<HTMLInputElement>('#opt-zscale').value) || 1.5;
    const baseMm = Number(el<HTMLInputElement>('#opt-base').value) || 4;
    const layers = {
      buildings: checked('#opt-buildings'),
      roads: checked('#opt-roads'),
      water: checked('#opt-water'),
      green: checked('#opt-green'),
    };
    const wantDetails = Object.values(layers).some(Boolean);

    const wM = widthMeters(bounds);
    const hM = heightMeters(bounds);
    if (wM < 40 || hM < 40) throw new Error('Sélection trop petite — choisissez une plus grande zone.');
    if (wM > 60000 || hM > 60000) throw new Error('Sélection trop grande — restez sous ~60 km.');
    if (wantDetails && (wM > 6000 || hM > 6000)) {
      throw new Error('Les détails de carte demandent une sélection sous ~6 km — réduisez le carré ou décochez les calques.');
    }

    const print = resolvePrintSize(bounds);
    // Overflow preview: build the full zone at true scale (may exceed 400 mm).
    // Rebuild: keep only the centered bed window and cut the surplus.
    const applyCrop = mode === 'rebuild' && print.overflow && print.cropBounds !== null;
    const buildBounds = applyCrop ? print.cropBounds! : bounds;
    const widthMm = applyCrop ? print.bedWidthMm : print.widthMm;
    const depthMm = applyCrop ? print.bedDepthMm : print.depthMm;
    const maxMm = applyCrop || !print.overflow ? 400 : 2000;
    if (widthMm < 20 || depthMm < 20 || widthMm > maxMm || depthMm > maxMm) {
      throw new Error('Taille d’impression hors limites.');
    }

    const fetchBounds = bounds; // always cache DEM for the full selected square
    const key = boundsKey(fetchBounds);
    let dem = cachedDem;
    let features = cachedFeatures;
    if (cacheKey !== key || !dem) {
      setStatus('Récupération du relief…');
      dem = await loadDem(fetchBounds);
      features = null;
      if (wantDetails) {
        setStatus('Récupération des données OpenStreetMap…');
        features = await fetchMapFeatures(fetchBounds);
      }
      cacheKey = key;
      cachedDem = dem;
      cachedFeatures = features;
    } else if (wantDetails && !features) {
      setStatus('Récupération des données OpenStreetMap…');
      features = await fetchMapFeatures(fetchBounds);
      cachedFeatures = features;
    }

    setStatus(mode === 'rebuild' ? 'Réorganisation du modèle…' : 'Construction du terrain…');
    const buildWM = widthMeters(buildBounds);
    const buildHM = heightMeters(buildBounds);
    const grid = sampleGrid(buildBounds, dem, widthMm, depthMm);
    const space = new ModelSpace(buildBounds, widthMm, zFactor, baseMm, grid.minElevation);

    // During overflow preview, keep the full square so the bed window is obvious.
    // Cut shapes apply after « Réorganiser » (cropped print) or when there is no overflow.
    const cutShape = applyCrop || !print.overflow ? readCutShape() : 'none';
    const cutRing = cutFootprint(buildBounds, cutShape);
    const rawMask = cutRing.length >= 3 ? cellMaskFromFootprint(grid, cutRing) : null;
    const cellMask = rawMask && rawMask.some((v) => v === 0) ? rawMask : null;
    // Pass the cut polygon whenever the shape is not the full square — used to
    // hard-clip buildings/roads (centroid tests left stubs outside the curve).
    const clipFoot = cutShape !== 'none' ? cutRing : null;
    const outsideShape =
      clipFoot && clipFoot.length >= 3 ? outsideFootprintSubmask(grid, clipFoot, 4) : null;

    const bodies: NamedBody[] = [
      { name: 'Base', geometry: buildBase(grid, space, cellMask), color: COLORS.base },
      { name: 'Terrain', geometry: buildTerrain(grid, space, cellMask), color: COLORS.terrain },
    ];

    if (features) {
      const add = (name: string, geometry: THREE.BufferGeometry | null, color: number) => {
        if (geometry) bodies.push({ name, geometry, color });
      };
      const mergeExclude = (a?: Uint8Array | null, b?: Uint8Array | null) => {
        if (!a) return b ?? undefined;
        if (!b) return a;
        const out = new Uint8Array(a.length);
        for (let i = 0; i < a.length; i++) out[i] = a[i] | b[i];
        return out;
      };

      let water = null;
      if (layers.water) {
        setStatus(`Projection de ${features.water.length} plans d’eau…`);
        water = buildPolygonOverlay(
          features.water,
          buildBounds,
          space,
          dem,
          grid,
          WATER_STYLE,
          outsideShape ?? undefined,
        );
      }
      if (layers.green) {
        setStatus(`Projection de ${features.green.length} zones vertes…`);
        add(
          'Greenery',
          buildPolygonOverlay(
            features.green,
            buildBounds,
            space,
            dem,
            grid,
            GREEN_STYLE,
            mergeExclude(water?.mask, outsideShape),
          ).geometry,
          COLORS.green,
        );
      }
      if (water) add('Water', water.geometry, COLORS.water);
      if (layers.roads) {
        setStatus(`Traitement de ${features.roads.length} routes…`);
        add(
          'Roads',
          mergeSoups(
            buildRoadOverlay(features.roads, buildBounds, space, dem, ROAD_STYLE, clipFoot),
            buildPolygonOverlay(
              features.aprons,
              buildBounds,
              space,
              dem,
              grid,
              ROAD_STYLE,
              outsideShape ?? undefined,
            ).geometry,
          ),
          COLORS.roads,
        );
      }
      if (layers.buildings) {
        setStatus(`Extrusion de ${features.buildings.length} bâtiments…`);
        add(
          'Buildings',
          buildBuildings(features.buildings, buildBounds, space, dem, clipFoot),
          COLORS.buildings,
        );
      }
    }

    const heightMm = modelHeightMm(bodies);
    const showOverflowPreview = print.overflow && !applyCrop;
    const meta: ModelMeta = {
      widthMm: space.widthMm,
      depthMm: space.depthMm,
      heightMm,
      scaleRatio: print.scaleRatio,
      groundWidthM: buildWM,
      groundDepthM: buildHM,
      bedCrop: showOverflowPreview
        ? { widthMm: print.bedWidthMm, depthMm: print.bedDepthMm }
        : null,
    };
    preview.show(bodies, meta);
    showPreviewMeta(meta, showOverflowPreview ? print : null);
    previewEmpty.hidden = true;
    studioPanel.hidden = false;
    hasModel = true;
    exportBodies = bodies;

    if (showOverflowPreview) {
      btnDownload.disabled = true;
      btnDownload3mf.disabled = true;
      exportHint.textContent =
        'Hors plateau assombri — cliquez « Réorganiser le modèle » pour couper au centre, puis téléchargez.';
    } else {
      btnDownload.disabled = false;
      btnDownload3mf.disabled = false;
      exportHint.textContent = 'Prêt — téléchargez le 3MF ou le STL.';
    }
    updatePrintHint(bounds);

    const tris = bodies.reduce((n, b) => n + b.geometry.getAttribute('position').count / 3, 0);
    setStatus(
      showOverflowPreview
        ? `Aperçu 1:${fmtScaleNum(print.scaleRatio)} — surplus assombri · réorganisez pour couper à ${print.bedWidthMm} × ${print.bedDepthMm} mm`
        : `Terminé — ${fmtMm(space.widthMm)} × ${fmtMm(space.depthMm)} × ${fmtMm(heightMm)} mm · ` +
            `1:${fmtScaleNum(print.scaleRatio)} · ${Math.round(tris).toLocaleString('fr-FR')} triangles`,
    );
    if (mode === 'first') {
      mapHint.hidden = false;
      mapHint.textContent = showOverflowPreview
        ? 'Plateau trop petit pour l’échelle — le centre reste clair, le reste sera coupé'
        : 'Étapes 2–4 à droite : impression, découpe, export';
    }
  } catch (err) {
    console.error(err);
    setStatus(err instanceof Error ? err.message : 'Échec de la génération — voir la console.');
  } finally {
    generating = false;
    btnGenerate.disabled = selection === null;
    btnRebuild.disabled = false;
  }
}

function modelHeightMm(bodies: NamedBody[]): number {
  let maxZ = 0;
  for (const body of bodies) {
    body.geometry.computeBoundingBox();
    const box = body.geometry.boundingBox;
    if (box) maxZ = Math.max(maxZ, box.max.z);
  }
  return maxZ;
}

function fmtMm(mm: number): string {
  return mm < 10 ? mm.toFixed(1) : Math.round(mm).toString();
}

function fmtScaleNum(ratio: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 3 }).format(ratio);
}

function fmtScale(ratio: number): string {
  return `1:${fmtScaleNum(ratio)}`;
}

function fmtGround(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

function showPreviewMeta(
  meta: ModelMeta,
  overflow: { bedWidthMm: number; bedDepthMm: number } | null,
): void {
  previewMeta.hidden = false;
  previewMetaScale.textContent = `Échelle ${fmtScale(meta.scaleRatio)}`;
  if (overflow) {
    previewMetaDims.textContent =
      `Plateau ${fmtMm(overflow.bedWidthMm)} × ${fmtMm(overflow.bedDepthMm)} mm (centre)`;
    previewMetaGround.textContent =
      `Zone ${fmtGround(meta.groundWidthM)} × ${fmtGround(meta.groundDepthM)} — surplus à couper`;
  } else {
    previewMetaDims.textContent =
      `Modèle ${fmtMm(meta.widthMm)} × ${fmtMm(meta.depthMm)} × ${fmtMm(meta.heightMm)} mm`;
    previewMetaGround.textContent =
      `Terrain ${fmtGround(meta.groundWidthM)} × ${fmtGround(meta.groundDepthM)}`;
  }
}

btnGenerate.addEventListener('click', () => void generate('first'));
btnRebuild.addEventListener('click', () => void generate('rebuild'));
btnDownload.addEventListener('click', () => {
  if (exportBodies.length > 0) {
    downloadStl(exportBodies.map((b) => b.geometry), 'perspectives-topo.stl');
  }
});
btnDownload3mf.addEventListener('click', () => {
  if (exportBodies.length === 0) return;
  void (async () => {
    const large = await preview.snapshot(512);
    const small = await preview.snapshot(128);
    await downloadThreeMf(
      exportBodies,
      'perspectives-topo.3mf',
      large && small ? { large, small } : undefined,
    );
  })();
});

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__tinytopo = {
    select: (b: Bounds) => {
      selection = b;
      btnGenerate.disabled = generating;
      mapHint.hidden = true;
    },
    generate: () => generate('first'),
    stl: async () => {
      const { toBinaryStl } = await import('./export/stl');
      return toBinaryStl(exportBodies.map((b) => b.geometry));
    },
    threeMf: async () => {
      const { toThreeMf } = await import('./export/threeMf');
      const large = await preview.snapshot(512);
      const small = await preview.snapshot(128);
      return toThreeMf(exportBodies, large && small ? { large, small } : undefined);
    },
  };
}
