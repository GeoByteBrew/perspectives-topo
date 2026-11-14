import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import { Bounds } from './geo';
import {
  LonLatRing,
  boundsFromCenter,
  circleRing,
  heartRing,
  rectangleRing,
  triangleRing,
} from './shapes';

export interface MapController {
  map: L.Map;
  getSelection(): Bounds | null;
  getFootprint(): LonLatRing | null;
  flyTo(bounds: Bounds): void;
  placeRectangle(widthM: number, heightM: number, center?: { lat: number; lon: number }): void;
  placeCircle(radiusM: number, center?: { lat: number; lon: number }): void;
  placeTriangle(sizeM: number, center?: { lat: number; lon: number }): void;
  placeHeart(sizeM: number, center?: { lat: number; lon: number }): void;
  /** Next map click places the pending shape (or cancels if null). */
  armClickPlace(handler: ((lat: number, lon: number) => void) | null): void;
  clearSelection(): void;
}

const MONTPELLIER = { lat: 43.6108, lon: 3.8767 };

const STYLE: L.PathOptions = {
  color: '#e8a33d',
  weight: 2,
  fillColor: '#e8a33d',
  fillOpacity: 0.18,
};

export function createMap(
  container: HTMLElement,
  onSelectionChange: (bounds: Bounds | null) => void,
): MapController {
  const map = L.map(container, { zoomControl: true }).setView([MONTPELLIER.lat, MONTPELLIER.lon], 14);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  // Freehand rectangle remains available; precise tools live in the left panel.
  map.pm.addControls({
    position: 'topright',
    drawMarker: false,
    drawCircleMarker: false,
    drawPolyline: false,
    drawPolygon: false,
    drawCircle: false,
    drawText: false,
    drawRectangle: true,
    editMode: true,
    dragMode: true,
    cutPolygon: false,
    rotateMode: false,
    removalMode: true,
  });

  let selectionLayer: L.Polygon | L.Rectangle | null = null;
  let footprint: LonLatRing | null = null;
  let clickPlace: ((lat: number, lon: number) => void) | null = null;

  const boundsOfLayer = (layer: L.Polygon | L.Rectangle): Bounds => {
    const b = layer.getBounds();
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  };

  const notify = () => onSelectionChange(selectionLayer ? boundsOfLayer(selectionLayer) : null);

  const clearSelection = () => {
    if (selectionLayer) {
      selectionLayer.remove();
      selectionLayer = null;
    }
    footprint = null;
    notify();
  };

  const setPolygon = (ring: LonLatRing, fit = true) => {
    clearSelection();
    footprint = ring;
    selectionLayer = L.polygon(
      ring.map(([lon, lat]) => [lat, lon] as L.LatLngExpression),
      STYLE,
    ).addTo(map);
    selectionLayer.on('pm:edit', () => {
      const latlngs = (selectionLayer as L.Polygon).getLatLngs()[0] as L.LatLng[];
      footprint = latlngs.map((ll) => [ll.lng, ll.lat] as [number, number]);
      if (footprint.length && (footprint[0][0] !== footprint[footprint.length - 1][0] || footprint[0][1] !== footprint[footprint.length - 1][1])) {
        footprint.push(footprint[0]);
      }
      notify();
    });
    selectionLayer.on('pm:dragend', notify);
    if (fit) {
      map.fitBounds(selectionLayer.getBounds(), { maxZoom: 17, padding: [40, 40] });
    }
    notify();
  };

  const centerOrMap = (center?: { lat: number; lon: number }) =>
    center ?? { lat: map.getCenter().lat, lon: map.getCenter().lng };

  const placeRectangle = (widthM: number, heightM: number, center?: { lat: number; lon: number }) => {
    const c = centerOrMap(center);
    const b = boundsFromCenter(c.lat, c.lon, widthM, heightM);
    setPolygon(rectangleRing(b));
  };

  const placeCircle = (radiusM: number, center?: { lat: number; lon: number }) => {
    const c = centerOrMap(center);
    setPolygon(circleRing(c.lat, c.lon, radiusM));
  };

  const placeTriangle = (sizeM: number, center?: { lat: number; lon: number }) => {
    const c = centerOrMap(center);
    setPolygon(triangleRing(c.lat, c.lon, sizeM));
  };

  const placeHeart = (sizeM: number, center?: { lat: number; lon: number }) => {
    const c = centerOrMap(center);
    setPolygon(heartRing(c.lat, c.lon, sizeM));
  };

  map.on('pm:create', (e) => {
    if (e.shape !== 'Rectangle') return;
    clearSelection();
    selectionLayer = e.layer as L.Rectangle;
    const b = boundsOfLayer(selectionLayer);
    footprint = rectangleRing(b);
    selectionLayer.setStyle(STYLE);
    selectionLayer.on('pm:edit', notify);
    selectionLayer.on('pm:dragend', notify);
    notify();
  });

  map.on('pm:remove', (e) => {
    if (e.layer === selectionLayer) {
      selectionLayer = null;
      footprint = null;
      notify();
    }
  });

  map.on('click', (e: L.LeafletMouseEvent) => {
    if (!clickPlace) return;
    const handler = clickPlace;
    clickPlace = null;
    map.getContainer().style.cursor = '';
    handler(e.latlng.lat, e.latlng.lng);
  });

  return {
    map,
    getSelection: () => (selectionLayer ? boundsOfLayer(selectionLayer) : null),
    getFootprint: () => footprint,
    flyTo: (b) =>
      map.fitBounds(L.latLngBounds([b.south, b.west], [b.north, b.east]), { maxZoom: 16 }),
    placeRectangle,
    placeCircle,
    placeTriangle,
    placeHeart,
    armClickPlace: (handler) => {
      clickPlace = handler;
      map.getContainer().style.cursor = handler ? 'crosshair' : '';
    },
    clearSelection,
  };
}

interface NominatimResult {
  display_name: string;
  boundingbox: [string, string, string, string]; // south, north, west, east
}

/** Wire the place-search box to Nominatim (search on Enter only, per usage policy). */
export function setupSearch(controller: MapController): void {
  const input = document.querySelector<HTMLInputElement>('#search-input')!;
  const results = document.querySelector<HTMLUListElement>('#search-results')!;

  const hide = () => {
    results.hidden = true;
    results.replaceChildren();
  };

  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const q = input.value.trim();
    if (!q) return;
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`,
      );
      if (!resp.ok) throw new Error(`Nominatim: ${resp.status}`);
      const places = (await resp.json()) as NominatimResult[];
      results.replaceChildren(
        ...places.map((p) => {
          const li = document.createElement('li');
          li.textContent = p.display_name;
          li.addEventListener('click', () => {
            const [s, n, w, ee] = p.boundingbox.map(Number);
            controller.flyTo({ south: s, north: n, west: w, east: ee });
            hide();
          });
          return li;
        }),
      );
      results.hidden = places.length === 0;
    } catch (err) {
      console.error('Search failed', err);
    }
  });

  document.addEventListener('click', (e) => {
    if (!results.contains(e.target as Node) && e.target !== input) hide();
  });
}
