// Three.js のカード演出。画面全体を覆う透明な WebGL キャンバスに、DOM のカードと同じ位置・大きさで板を出して、
// 移動しながら裏返す。z = 0 の平面が CSS のピクセルと 1 対 1 になるようにカメラを置いている。
import * as THREE from "three";
import { artKey, artToCanvas, type Art } from "./ascii.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

interface Flight {
  group: THREE.Group;
  shadow: THREE.Mesh;
  front: THREE.Mesh;
  back: THREE.Mesh | null;
  t0: number;
  dur: number;
  update: (t: number) => void;
  done: () => void;
}

const FOV = 32;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let flights: Flight[] = [];
let ambient: { group: THREE.Group; vx: number; vy: number; vr: number; flip: number }[] = [];
let raf = 0;
let timer = 0;
const texCache = new Map<string, THREE.CanvasTexture>();
const geo = new THREE.PlaneGeometry(1, 1);
let speed = 1;

export function setSpeed(f: number): void {
  speed = f;
}

export function initFlip(): void {
  if (renderer) return;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    renderer = null; // WebGL が無い環境では演出なしで進める
    return;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setClearColor(0x000000, 0);
  const cv = renderer.domElement;
  cv.id = "flip3d";
  document.body.appendChild(cv);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 10, 10000);
  resize();
  window.addEventListener("resize", resize);
  (window as unknown as { __flip: unknown }).__flip = { scene, camera, renderer, get ambient() { return ambient; }, get flights() { return flights; } };
}

function resize(): void {
  if (!renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.position.set(0, 0, h / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

export function setLayer(mode: "front" | "behind"): void {
  if (renderer) renderer.domElement.dataset.layer = mode;
}

function texture(art: Art): THREE.CanvasTexture {
  const key = artKey(art);
  let t = texCache.get(key);
  if (!t) {
    t = new THREE.CanvasTexture(artToCanvas(art));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    if (texCache.size > 300) {
      const first = texCache.keys().next().value!;
      texCache.get(first)!.dispose();
      texCache.delete(first);
    }
    texCache.set(key, t);
  }
  return t;
}

function toWorld(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2 - window.innerWidth / 2, y: window.innerHeight / 2 - (r.y + r.h / 2) };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function loop(): void {
  raf = 0;
  timer = 0;
  if (!renderer) return;
  const now = performance.now();
  for (const f of [...flights]) {
    const t = Math.min(1, Math.max(0, (now - f.t0) / f.dur));
    f.update(t);
    if (t >= 1 && now >= f.t0) {
      scene.remove(f.group, f.shadow);
      flights = flights.filter((x) => x !== f);
      f.done();
    }
  }
  for (const a of ambient) {
    a.group.position.x += a.vx;
    a.group.position.y += a.vy;
    a.group.rotation.y += a.flip;
    a.group.rotation.z += a.vr;
    const H = window.innerHeight / 2 + 200;
    if (a.group.position.y < -H) a.group.position.y = H;
    if (a.group.position.y > H) a.group.position.y = -H;
    shade(a.group, 0.55);
  }
  renderer.render(scene, camera);
  if (flights.length || ambient.length) kick();
}

/** 次のフレームを予約する。rAF が止まる環境（隠れたタブなど）でも進むように、タイマーでも呼ぶ */
function kick(): void {
  if (raf || !renderer) return;
  const tick = () => {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    loop();
  };
  raf = requestAnimationFrame(tick);
  timer = window.setTimeout(tick, 50);
}

function shade(group: THREE.Group, max = 1): void {
  const c = Math.abs(Math.cos(group.rotation.y));
  group.children.forEach((m) => ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setScalar(max * (0.45 + 0.55 * c)));
}

function cardGroup(startArt: Art, endArt: Art, flip: boolean): { group: THREE.Group; front: THREE.Mesh; back: THREE.Mesh | null } {
  const group = new THREE.Group();
  const front = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture(endArt) }));
  group.add(front);
  let back: THREE.Mesh | null = null;
  if (flip) {
    back = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture(startArt) }));
    back.rotation.y = Math.PI;
    group.add(back);
  }
  return { group, front, back };
}

export interface FlyOpts {
  from: Rect;
  to: Rect;
  startArt: Art;
  endArt: Art;
  /** 裏返す回数（0 なら裏返さない。startArt と endArt が違うときは 1 以上の奇数にする） */
  flips?: number;
  duration?: number;
  delay?: number;
  lift?: number;
  spin?: number;
  /** 途中で止まって見せる場所（記号カードの中央表示） */
  via?: Rect;
  hold?: number;
  tint?: number;
  onLand?: () => void;
}

/** カードを from から to へ飛ばす。終わったら resolve */
export function fly(o: FlyOpts): Promise<void> {
  if (!renderer || speed <= 0) {
    o.onLand?.();
    return Promise.resolve();
  }
  const flips = o.flips ?? (artKey(o.startArt) === artKey(o.endArt) ? 0 : 1);
  const { group, front, back } = cardGroup(o.startArt, o.endArt, flips > 0);
  const shadow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }));
  shadow.position.z = -2;
  if (o.tint !== undefined) {
    (front.material as THREE.MeshBasicMaterial).color.setHex(o.tint);
  }
  const dur = (o.duration ?? 520) / speed;
  const hold = (o.hold ?? 600) / speed;
  const lift = o.lift ?? 120;
  const total = o.via ? dur * 2 + hold : dur;
  const delay = (o.delay ?? 0) / speed;
  group.visible = false;
  shadow.visible = false;
  scene.add(shadow, group);
  const place = (a: Rect, b: Rect, k: number, rotY: number, z: number) => {
    const pa = toWorld(a);
    const pb = toWorld(b);
    const e = ease(k);
    group.position.set(pa.x + (pb.x - pa.x) * e, pa.y + (pb.y - pa.y) * e, z);
    group.scale.set(a.w + (b.w - a.w) * e, a.h + (b.h - a.h) * e, 1);
    group.rotation.y = rotY;
    shadow.position.set(group.position.x + z * 0.12, group.position.y - z * 0.18, -2);
    shadow.scale.copy(group.scale);
    shadow.rotation.y = rotY;
    (shadow.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.min(0.35, z / 600);
  };
  return new Promise((resolve) => {
    flights.push({
      group,
      shadow,
      front,
      back,
      t0: performance.now() + delay,
      dur: total,
      update: (t) => {
        group.visible = shadow.visible = true;
        const ms = t * total;
        const rot0 = Math.PI * flips;
        if (!o.via) {
          const e = ease(t);
          place(o.from, o.to, t, rot0 * (1 - e), Math.sin(Math.PI * t) * lift);
          group.rotation.z = (o.spin ?? 0) * Math.PI * 2 * e;
        } else if (ms < dur) {
          const k = ms / dur;
          place(o.from, o.via, k, rot0 * (1 - ease(k)), Math.sin((Math.PI / 2) * k) * lift);
        } else if (ms < dur + hold) {
          place(o.via, o.via, 1, 0, lift + Math.sin(((ms - dur) / hold) * Math.PI) * 10);
        } else {
          const k = (ms - dur - hold) / dur;
          place(o.via, o.to, k, 0, Math.cos((Math.PI / 2) * k) * lift);
        }
        shade(group);
      },
      done: () => {
        o.onLand?.();
        resolve();
      },
    });
    kick();
  });
}

/** その場で裏返す（進化など） */
export function flipInPlace(r: Rect, startArt: Art, endArt: Art, opts: { flips?: number; duration?: number; lift?: number } = {}): Promise<void> {
  return fly({ from: r, to: r, startArt, endArt, flips: opts.flips ?? 1, duration: opts.duration ?? 700, lift: opts.lift ?? 160 });
}

/** タイトル画面の背景で、ゆっくり回るカード */
export function startAmbient(arts: Art[]): void {
  stopAmbient();
  if (!renderer) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const s = Math.min(W / 1600, H / 900);
  arts.forEach((art, i) => {
    const { group } = cardGroup(arts[(i + 3) % arts.length], art, true);
    const k = 0.55 + ((i * 37) % 10) / 20;
    group.scale.set(150 * s * k, 240 * s * k, 1);
    group.position.set(((i / arts.length) - 0.5) * W * 1.05, ((i * 53) % 100) / 100 * H - H / 2, -200 - ((i * 71) % 400));
    group.rotation.y = i;
    scene.add(group);
    ambient.push({ group, vx: 0, vy: -(0.25 + ((i * 13) % 7) / 14) * s, vr: (((i % 3) - 1) * 0.0015), flip: 0.004 + (i % 4) * 0.002 });
  });
  kick();
}

export function stopAmbient(): void {
  for (const a of ambient) scene?.remove(a.group);
  ambient = [];
  if (renderer) renderer.render(scene, camera);
}
