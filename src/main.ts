import './style.css';
import * as THREE from 'three';
import { Bounds, ModelSpace, widthMeters, heightMeters } from './geo';
import { loadDem } from './elevation';
import { fetchMapFeatures, MapFeatures } from './overpass';
import { sampleGrid, buildTerrain, buildBase } from './geometry/terrain';
import { buildBuildings } from './geometry/buildings';
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
const btnDownload = el<HTMLButtonElement>('#btn-download');
const btnDownload3mf = el<HTMLButtonElement>('#btn-download-3mf');
const status = el<HTMLSpanElement>('#status');
const mapHint = el<HTMLDivElement>('#map-hint');
const previewEmpty = el<HTMLDivElement>('#preview-empty');
const previewMeta = el<HTMLElement>('#preview-meta');
const previewMetaScale = el<HTMLElement>('#preview-meta-scale');
const previewMetaDims = el<HTMLElement>('#preview-meta-dims');
const previewMetaGround = el<HTMLElement>('#preview-meta-ground');

let selection: Bounds | null = null;
let exportBodies: NamedBody[] = [];
let generating = false;

const mapController = createMap(el('#map'), (bounds) => {
  selection = bounds;
  btnGenerate.disabled = bounds === null || generating;
  mapHint.hidden = bounds !== null;
});
setupSearch(mapController);

const preview = new Preview(el<HTMLCanvasElement>('#preview'));

function setStatus(text: string): void {
  status.textContent = text;
}

const checked = (id: string): boolean => el<HTMLInputElement>(id).checked;

async function generate(): Promise<void> {
  if (!selection || generating) return;
  const bounds = selection;
  generating = true;
  btnGenerate.disabled = true;
  btnDownload.disabled = true;
  btnDownload3mf.disabled = true;

  try {
    const widthMm = Number(el<HTMLInputElement>('#opt-width').value) || 120;
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
    if (wM < 50 || hM < 50) throw new Error('Sélection trop petite — dessinez un plus grand rectangle.');
    if (wM > 60000 || hM > 60000) throw new Error('Sélection trop grande — restez sous ~60 km.');
    if (wantDetails && (wM > 6000 || hM > 6000)) {
      throw new Error('Les détails de carte demandent une sélection sous ~6 km — réduisez-la ou décochez les calques.');
    }

    setStatus('Récupération du relief…');
    const dem = await loadDem(bounds);

    let features: MapFeatures | null = null;
    if (wantDetails) {
      setStatus('Récupération des données OpenStreetMap…');
      features = await fetchMapFeatures(bounds);
    }

    setStatus('Construction du terrain…');
    const depthMm = (hM / wM) * widthMm;
    const grid = sampleGrid(bounds, dem, widthMm, depthMm);
    const space = new ModelSpace(bounds, widthMm, zFactor, baseMm, grid.minElevation);
    const bodies: NamedBody[] = [
      { name: 'Base', geometry: buildBase(grid, space), color: COLORS.base },
      { name: 'Terrain', geometry: buildTerrain(grid, space), color: COLORS.terrain },
    ];

    if (features) {
      const add = (name: string, geometry: THREE.BufferGeometry | null, color: number) => {
        if (geometry) bodies.push({ name, geometry, color });
      };
      // Water is computed first so greenery can be excluded from its cells
      // (reserves/forests in OSM often contain their lakes), but body order
      // stays stable so filament slot mapping doesn't shift.
      let water = null;
      if (layers.water) {
        setStatus(`Projection de ${features.water.length} plans d’eau…`);
        water = buildPolygonOverlay(features.water, bounds, space, dem, grid, WATER_STYLE);
      }
      if (layers.green) {
        setStatus(`Projection de ${features.green.length} zones vertes…`);
        add(
          'Greenery',
          buildPolygonOverlay(features.green, bounds, space, dem, grid, GREEN_STYLE, water?.mask).geometry,
          COLORS.green,
        );
      }
      if (water) add('Water', water.geometry, COLORS.water);
      if (layers.roads) {
        setStatus(`Traitement de ${features.roads.length} routes…`);
        add(
          'Roads',
          mergeSoups(
            buildRoadOverlay(features.roads, bounds, space, dem, ROAD_STYLE),
            buildPolygonOverlay(features.aprons, bounds, space, dem, grid, ROAD_STYLE).geometry,
          ),
          COLORS.roads,
        );
      }
      if (layers.buildings) {
        setStatus(`Extrusion de ${features.buildings.length} bâtiments…`);
        add('Buildings', buildBuildings(features.buildings, bounds, space, dem), COLORS.buildings);
      }
    }

    const heightMm = modelHeightMm(bodies);
    const meta: ModelMeta = {
      widthMm: space.widthMm,
      depthMm: space.depthMm,
      heightMm,
      scaleRatio: (wM * 1000) / space.widthMm,
      groundWidthM: wM,
      groundDepthM: hM,
    };
    preview.show(bodies, meta);
    showPreviewMeta(meta);
    previewEmpty.hidden = true;
    exportBodies = bodies;
    btnDownload.disabled = false;
    btnDownload3mf.disabled = false;

    const tris = bodies.reduce((n, b) => n + b.geometry.getAttribute('position').count / 3, 0);
    setStatus(
      `Terminé — ${fmtMm(space.widthMm)} × ${fmtMm(space.depthMm)} × ${fmtMm(heightMm)} mm, ` +
        `${Math.round(tris).toLocaleString('fr-FR')} triangles (${dem.source})`,
    );
  } catch (err) {
    console.error(err);
    setStatus(err instanceof Error ? err.message : 'Échec de la génération — voir la console.');
  } finally {
    generating = false;
    btnGenerate.disabled = selection === null;
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

function fmtScale(ratio: number): string {
  return `1:${new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 3 }).format(ratio)}`;
}

function fmtGround(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

function showPreviewMeta(meta: ModelMeta): void {
  previewMeta.hidden = false;
  previewMetaScale.textContent = `Échelle ${fmtScale(meta.scaleRatio)}`;
  previewMetaDims.textContent =
    `Modèle ${fmtMm(meta.widthMm)} × ${fmtMm(meta.depthMm)} × ${fmtMm(meta.heightMm)} mm`;
  previewMetaGround.textContent =
    `Terrain ${fmtGround(meta.groundWidthM)} × ${fmtGround(meta.groundDepthM)}`;
}

btnGenerate.addEventListener('click', () => void generate());
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
  // Debug hooks for tests: set a selection without the map UI, trigger a
  // build, and read back the export bytes.
  (window as unknown as Record<string, unknown>).__tinytopo = {
    select: (b: Bounds) => {
      selection = b;
      btnGenerate.disabled = generating;
      mapHint.hidden = true;
    },
    generate: () => generate(),
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
