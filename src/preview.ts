import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface PreviewItem {
  geometry: THREE.BufferGeometry;
  color: number;
}

/** Print-size info shown on the model and in the preview HUD. */
export interface ModelMeta {
  widthMm: number;
  depthMm: number;
  heightMm: number;
  /** Real-world / model, e.g. 12500 for 1:12 500. */
  scaleRatio: number;
  groundWidthM: number;
  groundDepthM: number;
}

/** Three.js viewport for the generated model. Geometries are Z-up mm. */
export class Preview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private group = new THREE.Group();
  private dimsGroup = new THREE.Group();

  constructor(private canvas: HTMLCanvasElement) {
    // preserveDrawingBuffer lets snapshot() read pixels for 3MF thumbnails.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.scene.background = new THREE.Color(0x0b0d0f);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    // Model space is Z-up; rotate into Three's Y-up for display.
    this.group.rotation.x = -Math.PI / 2;
    this.scene.add(this.group);
    this.group.add(this.dimsGroup);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 2, 1.2);
    this.scene.add(sun);

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Render layered geometries; the first item is used to frame the camera. */
  show(items: PreviewItem[], meta?: ModelMeta): void {
    this.clear();
    items.forEach(({ geometry, color }, i) => {
      // Bodies share coplanar faces (base/terrain walls, embedded slabs);
      // bias later layers slightly toward the camera to avoid z-fighting.
      const material = new THREE.MeshStandardMaterial({
        color,
        polygonOffset: true,
        polygonOffsetFactor: -i,
        polygonOffsetUnits: -i,
      });
      this.group.add(new THREE.Mesh(geometry, material));
    });
    if (items.length > 0) this.fit(items[0].geometry);
    if (meta) this.drawDimensions(meta);
  }

  private drawDimensions(meta: ModelMeta): void {
    const w = meta.widthMm;
    const d = meta.depthMm;
    const h = meta.heightMm;
    const hx = w / 2;
    const hy = d / 2;
    // Offset ticks slightly outside the footprint so they stay readable.
    const pad = Math.max(w, d) * 0.04;

    const lineMat = new THREE.LineBasicMaterial({ color: 0xe8a33d, transparent: true, opacity: 0.9 });
    const addLine = (points: THREE.Vector3[]) => {
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      this.dimsGroup.add(new THREE.Line(geo, lineMat));
    };

    // Width (X) along the south edge, in front of the model.
    const yFront = -hy - pad;
    addLine([new THREE.Vector3(-hx, yFront, 0), new THREE.Vector3(hx, yFront, 0)]);
    addLine([new THREE.Vector3(-hx, yFront - pad * 0.4, 0), new THREE.Vector3(-hx, yFront + pad * 0.4, 0)]);
    addLine([new THREE.Vector3(hx, yFront - pad * 0.4, 0), new THREE.Vector3(hx, yFront + pad * 0.4, 0)]);

    // Depth (Y) along the west edge.
    const xLeft = -hx - pad;
    addLine([new THREE.Vector3(xLeft, -hy, 0), new THREE.Vector3(xLeft, hy, 0)]);
    addLine([new THREE.Vector3(xLeft - pad * 0.4, -hy, 0), new THREE.Vector3(xLeft + pad * 0.4, -hy, 0)]);
    addLine([new THREE.Vector3(xLeft - pad * 0.4, hy, 0), new THREE.Vector3(xLeft + pad * 0.4, hy, 0)]);

    // Height (Z) at the south-west corner.
    addLine([new THREE.Vector3(-hx, -hy, 0), new THREE.Vector3(-hx, -hy, h)]);
    addLine([
      new THREE.Vector3(-hx - pad * 0.35, -hy, 0),
      new THREE.Vector3(-hx + pad * 0.35, -hy, 0),
    ]);
    addLine([
      new THREE.Vector3(-hx - pad * 0.35, -hy, h),
      new THREE.Vector3(-hx + pad * 0.35, -hy, h),
    ]);

    const fmt = (mm: number) => `${mm < 10 ? mm.toFixed(1) : Math.round(mm)} mm`;
    this.dimsGroup.add(makeLabel(fmt(w), new THREE.Vector3(0, yFront - pad * 0.9, 0), Math.max(w, d)));
    this.dimsGroup.add(makeLabel(fmt(d), new THREE.Vector3(xLeft - pad * 0.9, 0, 0), Math.max(w, d)));
    this.dimsGroup.add(makeLabel(fmt(h), new THREE.Vector3(-hx - pad * 1.1, -hy, h / 2), Math.max(w, d)));
  }

  private fit(reference: THREE.BufferGeometry): void {
    reference.computeBoundingBox();
    const box = reference.boundingBox;
    if (!box) return;
    const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
    const height = box.max.z - box.min.z;
    this.controls.target.set(0, height / 2, 0);
    this.camera.position.set(size * 0.55, size * 0.7, size * 0.95);
    this.camera.near = size / 100;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      if (child === this.dimsGroup) {
        for (const dim of [...this.dimsGroup.children]) {
          this.dimsGroup.remove(dim);
          disposeObject(dim);
        }
        continue;
      }
      this.group.remove(child);
      disposeObject(child);
    }
  }

  /** Square PNG snapshot of the current view (for 3MF cover thumbnails). */
  async snapshot(sizePx: number): Promise<Blob | null> {
    this.renderer.render(this.scene, this.camera);
    const src = this.canvas;
    const side = Math.min(src.width, src.height);
    const out = document.createElement('canvas');
    out.width = sizePx;
    out.height = sizePx;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, sizePx, sizePx);
    return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const { clientWidth: w, clientHeight: h } = parent;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

function makeLabel(text: string, position: THREE.Vector3, modelSize: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(16, 18, 20, 0.82)';
  ctx.strokeStyle = 'rgba(232, 163, 61, 0.9)';
  ctx.lineWidth = 2;
  roundRect(ctx, 8, 8, 240, 48, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f2efe8';
  ctx.font = '600 28px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.copy(position);
  const scale = Math.max(12, modelSize * 0.18);
  sprite.scale.set(scale, scale * 0.25, 1);
  return sprite;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function disposeObject(obj: THREE.Object3D): void {
  if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Sprite) {
    obj.geometry?.dispose();
    const mat = obj.material;
    if (Array.isArray(mat)) mat.forEach((m) => disposeMaterial(m));
    else if (mat) disposeMaterial(mat);
  }
}

function disposeMaterial(mat: THREE.Material): void {
  const m = mat as THREE.MeshStandardMaterial & { map?: THREE.Texture | null };
  m.map?.dispose();
  mat.dispose();
}
