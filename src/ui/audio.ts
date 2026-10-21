// BGM と効果音。audio/bgm・audio/se に置いたファイルをビルド時に見つけて使う（無いものは鳴らさない）。
// ブラウザは操作の前に音を出せないので、最初のクリックまで BGM を待たせる。
import audioJson from "../data/audio.json" with { type: "json" };
import { prefs, savePrefs } from "./prefs.ts";

const found = import.meta.glob("/audio/**/*.{mp3,ogg,wav,m4a}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const FILES = new Map<string, string>();
for (const [path, url] of Object.entries(found)) {
  const m = path.match(/^\/audio\/(bgm|se)\/(.+)\.\w+$/);
  if (m) FILES.set(`${m[1]}/${m[2]}`, url);
}

const A = audioJson;
let bgmEl: HTMLAudioElement | null = null;
let bgmName = "";
let wanted = "";
let unlocked = false;

function url(kind: "bgm" | "se", key: string): string | null {
  const name = (A[kind] as Record<string, string>)[key];
  return name ? FILES.get(`${kind}/${name}`) ?? null : null;
}

export function soundOn(): boolean {
  return prefs.sound;
}

export function setSound(on: boolean): void {
  prefs.sound = on;
  savePrefs();
  if (!on) stopBgm();
  else if (wanted) playBgm(wanted);
}

function fade(el: HTMLAudioElement, to: number, ms: number): Promise<void> {
  const from = el.volume;
  const t0 = performance.now();
  return new Promise((resolve) => {
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      el.volume = from + (to - from) * k;
      if (k < 1) setTimeout(step, 30);
      else resolve();
    };
    step();
  });
}

function stopBgm(): void {
  if (!bgmEl) return;
  const el = bgmEl;
  bgmEl = null;
  bgmName = "";
  void fade(el, 0, A.fadeMs).then(() => el.pause());
}

/** シーンの BGM（audio.json の bgm のキー）。同じなら何もしない */
export function playBgm(scene: string): void {
  wanted = scene;
  if (!prefs.sound || !unlocked) return;
  if (bgmName === scene && bgmEl) return;
  const src = url("bgm", scene);
  stopBgm();
  if (!src) return;
  const el = new Audio(src);
  el.loop = !scene.startsWith("result");
  el.volume = 0;
  bgmEl = el;
  bgmName = scene;
  el.play().then(() => fade(el, A.volume.bgm, A.fadeMs)).catch(() => {});
}

/** 効果音（audio.json の se のキー） */
export function playSe(key: string, volume = 1): void {
  if (!prefs.sound || !unlocked) return;
  const src = url("se", key);
  if (!src) return;
  const el = new Audio(src);
  el.volume = Math.min(1, A.volume.se * volume);
  el.play().catch(() => {});
}

export function pinchKOs(): number {
  return A.pinchKOs;
}

/** 最初の操作で音を出せるようにして、待っていた BGM を流す。ボタンのクリック音もここで付ける */
export function initAudio(): void {
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    if (wanted) playBgm(wanted);
  };
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
  document.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".btn:not(:disabled), .card.pick, .card.playable, .card.usable")) playSe("click");
  });
}

/** 見つかった音声ファイルの数（README・デバッグ用） */
export function audioFileCount(): number {
  return FILES.size;
}
