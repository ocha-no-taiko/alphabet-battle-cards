// BGM と効果音（Web Audio API）。audio/bgm・audio/se に置いたファイルをビルド時に見つけて使う（無いものは鳴らさない）。
// フェーズ BGM（バトル）は、全フェーズを同じ瞬間に流しはじめて、音量だけをクロスフェードで切り替える（ずれない）。
// ループは曲の頭の無音（MP3 の書き出しで入る空白）を飛ばしてつなぐので、継ぎ目で途切れない。
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
type BgmDef = string | { file?: string; loop?: boolean; layers?: string[] };

interface Playing {
  scene: string;
  out: GainNode;
  layers: GainNode[];
  sources: AudioBufferSourceNode[];
  layered: boolean;
}

let ctx: AudioContext | null = null;
let bgmBus: GainNode;
let seBus: GainNode;
let current: Playing | null = null;
let wanted = "";
let phase = 0;
let unlocked = false;
let seq = 0;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function url(kind: "bgm" | "se", name: string): string | null {
  return FILES.get(`${kind}/${name}`) ?? null;
}

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
  } catch {
    return null;
  }
  bgmBus = ctx.createGain();
  bgmBus.gain.value = A.volume.bgm;
  bgmBus.connect(ctx.destination);
  seBus = ctx.createGain();
  seBus.gain.value = A.volume.se;
  seBus.connect(ctx.destination);
  return ctx;
}

function load(src: string): Promise<AudioBuffer | null> {
  let p = buffers.get(src);
  if (!p) {
    const c = audio();
    p = c
      ? fetch(src)
          .then((r) => r.arrayBuffer())
          .then((b) => c.decodeAudioData(b))
          .catch(() => null)
      : Promise.resolve(null);
    buffers.set(src, p);
  }
  return p;
}

/** 曲の頭の無音の長さ（秒）。全フェーズで同じ位置からループさせるため、いちばん短いものを使う */
function leadingSilence(list: AudioBuffer[]): number {
  if (typeof A.loopStart === "number") return A.loopStart;
  let min = Infinity;
  for (const b of list) {
    const ch = b.getChannelData(0);
    const limit = Math.min(ch.length, Math.floor(b.sampleRate * 0.08)); // 80ms より長い無音は曲の一部とみなす
    let i = 0;
    while (i < limit && Math.abs(ch[i]) < 1e-4) i++;
    min = Math.min(min, i < limit ? i / b.sampleRate : 0);
  }
  return min === Infinity ? 0 : min;
}

function ramp(g: AudioParam, to: number, ms: number): void {
  const c = ctx!;
  const now = c.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(to, now + Math.max(0.01, ms / 1000));
}

function stopCurrent(): void {
  const p = current;
  if (!p || !ctx) return;
  current = null;
  ramp(p.out.gain, 0, A.fadeMs);
  const end = ctx.currentTime + A.fadeMs / 1000 + 0.05;
  for (const s of p.sources) {
    try {
      s.stop(end);
    } catch {
      // すでに止まっている
    }
  }
}

export function soundOn(): boolean {
  return prefs.sound;
}

export function setSound(on: boolean): void {
  prefs.sound = on;
  savePrefs();
  if (!on) stopCurrent();
  else if (wanted) playBgm(wanted);
}

/** シーンの BGM（audio.json の bgm のキー）。同じなら何もしない */
export function playBgm(scene: string): void {
  wanted = scene;
  if (!prefs.sound || !unlocked) return;
  if (current?.scene === scene) return;
  const def = (A.bgm as Record<string, BgmDef>)[scene];
  stopCurrent();
  const token = ++seq;
  if (!def) return;
  const layered = typeof def === "object" && !!def.layers;
  const names = typeof def === "string" ? [def] : def.layers ?? (def.file ? [def.file] : []);
  const loop = typeof def === "string" || def.loop !== false;
  const urls = names.map((n) => url("bgm", n));
  if (!urls.length || urls.some((u) => !u)) return;
  void Promise.all(urls.map((u) => load(u!))).then((list) => {
    const c = ctx;
    if (!c || token !== seq || !prefs.sound || list.some((b) => !b)) return;
    const bufs = list as AudioBuffer[];
    const out = c.createGain();
    out.gain.value = 0;
    out.connect(bgmBus);
    ramp(out.gain, 1, A.fadeMs);
    const offset = loop ? leadingSilence(bufs) : 0;
    const when = c.currentTime + 0.06; // 全部のフェーズを同じ瞬間に始める
    const layers: GainNode[] = [];
    const sources: AudioBufferSourceNode[] = [];
    bufs.forEach((b, i) => {
      const src = c.createBufferSource();
      src.buffer = b;
      src.loop = loop;
      if (loop) {
        src.loopStart = offset;
        src.loopEnd = b.duration;
      }
      const g = c.createGain();
      g.gain.value = layered ? (i === Math.min(phase, bufs.length - 1) ? 1 : 0) : 1;
      src.connect(g).connect(out);
      src.start(when, offset);
      layers.push(g);
      sources.push(src);
    });
    current = { scene, out, layers, sources, layered };
  });
}

/** バトルの撃破数から、フェーズ BGM の何本目を鳴らすか決める */
export function phaseFor(kos: [number, number], me: 0 | 1 = 0): number {
  const by = A.phase.by;
  return by === "total" ? kos[0] + kos[1] : by === "mine" ? kos[me] : Math.max(kos[0], kos[1]);
}

/** フェーズ BGM を n 本目（0 から）へ。クロスフェードで切り替える */
export function setBgmPhase(n: number): void {
  if (n === phase) return;
  phase = n;
  const p = current;
  if (!p?.layered || !ctx) return;
  const target = Math.min(n, p.layers.length - 1);
  p.layers.forEach((g, i) => ramp(g.gain, i === target ? 1 : 0, A.phase.fadeMs));
}

/** 効果音（audio.json の se のキー） */
export function playSe(key: string, volume = 1): void {
  if (!prefs.sound || !unlocked) return;
  const name = (A.se as Record<string, string>)[key];
  const src = name ? url("se", name) : null;
  if (!src) return;
  void load(src).then((b) => {
    const c = ctx;
    if (!b || !c) return;
    const s = c.createBufferSource();
    s.buffer = b;
    const g = c.createGain();
    g.gain.value = Math.min(1, volume);
    s.connect(g).connect(seBus);
    s.start();
  });
}

/** 最初の操作で音を出せるようにして、待っていた BGM を流す。ボタンのクリック音もここで付ける */
export function initAudio(): void {
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    void audio()?.resume();
    if (wanted) playBgm(wanted);
  };
  (window as unknown as { __audio: typeof audioDebug }).__audio = audioDebug; // 確認用
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
  document.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".btn:not(:disabled), .card.pick, .card.playable, .card.usable")) playSe("click");
  });
}

/** 見つかった音声ファイルの数（デバッグ用） */
export function audioFileCount(): number {
  return FILES.size;
}

/** いまの再生状態（確認用） */
export function audioDebug(): { scene: string | null; phase: number; gains: number[]; state: string; loopStart: number | null } {
  return {
    scene: current?.scene ?? null,
    phase,
    gains: current?.layers.map((g) => +g.gain.value.toFixed(2)) ?? [],
    state: ctx?.state ?? "none",
    loopStart: current?.sources[0]?.loop ? +current.sources[0].loopStart.toFixed(4) : null,
  };
}
