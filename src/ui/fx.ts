// 画面全体の演出（揺れ・フラッシュ・火花・画面切り替えのワイプ）。強さと長さは fx.json で調整する。
import fxJson from "../data/fx.json" with { type: "json" };
import theme from "../data/theme.json" with { type: "json" };
import { prefs } from "./prefs.ts";

export const FX = fxJson;
const sp = () => Math.max(0.5, prefs.speed);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 画面を揺らす。el は揺らす要素（対戦画面のルート） */
export function shake(el: HTMLElement | null, px: number, ms = FX.shake.ms): void {
  if (!el || px <= 0 || !el.animate) return;
  const n = 8;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= n; i++) {
    const k = 1 - i / n;
    const x = i === n ? 0 : (Math.random() * 2 - 1) * px * k;
    const y = i === n ? 0 : (Math.random() * 2 - 1) * px * k * 0.7;
    const r = i === n ? 0 : (Math.random() * 2 - 1) * px * 0.04 * k;
    frames.push({ transform: `translate(${x}px, ${y}px) rotate(${r}deg)` });
  }
  el.animate(frames, { duration: ms / sp(), easing: "linear" });
}

/** 画面全体を一瞬光らせる */
export function flash(color: string, opacity: number, ms: number): void {
  const el = document.createElement("div");
  el.className = "fx-flash";
  el.style.background = color;
  document.body.appendChild(el);
  const anim = el.animate([{ opacity }, { opacity: 0 }], { duration: ms / sp(), easing: "cubic-bezier(.2,.7,.3,1)" });
  anim.onfinish = () => el.remove();
}

const SPARK_CHARS = "*+x×#%@!/\\|-=~^:;.";

/** 文字の火花を飛ばす。at は画面上の中心 */
export function sparks(at: { x: number; y: number }, colors: string[], count = 18, power = 1): void {
  for (let i = 0; i < count; i++) {
    const el = document.createElement("span");
    el.className = "fx-spark";
    el.textContent = SPARK_CHARS[Math.floor(Math.random() * SPARK_CHARS.length)];
    el.style.color = colors[i % colors.length];
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
    el.style.fontSize = `${12 + Math.random() * 18 * power}px`;
    document.body.appendChild(el);
    const a = Math.random() * Math.PI * 2;
    const d = (60 + Math.random() * 160) * power;
    const rot = (Math.random() * 2 - 1) * 540;
    const anim = el.animate(
      [
        { transform: "translate(-50%, -50%) scale(1.4)", opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d + 30}px)) rotate(${rot}deg) scale(0.6)`, opacity: 0 },
      ],
      { duration: (500 + Math.random() * 400) / sp(), easing: "cubic-bezier(.1,.8,.3,1)" },
    );
    anim.onfinish = () => el.remove();
  }
}

export function centerOf(el: Element | null): { x: number; y: number } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** カードが相手に向かって突っ込む（dir: -1 = 上へ, 1 = 下へ） */
export function lunge(el: Element | null, dir: number): void {
  if (!(el instanceof HTMLElement) || !el.animate) return;
  const d = FX.lunge.px * dir;
  el.animate(
    [
      { transform: "translateY(0) scale(1)" },
      { transform: `translateY(${-d * 0.25}px) scale(0.97)`, offset: 0.25 },
      { transform: `translateY(${d}px) scale(1.08)`, offset: 0.55 },
      { transform: "translateY(0) scale(1)" },
    ],
    { duration: FX.lunge.ms / sp(), easing: "ease-out" },
  );
}

/** 当たったカードを赤く点滅させる */
export function hitBlink(el: Element | null, color = theme.danger): void {
  if (!(el instanceof HTMLElement) || !el.animate) return;
  el.animate(
    [
      { filter: "none", boxShadow: "none" },
      { filter: "brightness(2.2) saturate(0.2)", boxShadow: `0 0 0 3px ${color}, 0 0 40px ${color}` },
      { filter: "none", boxShadow: "none" },
    ],
    { duration: 320 / sp(), easing: "ease-out" },
  );
}

// ---- 画面切り替え（アスキーのワイプ） ----
// 文字の面は Canvas に一度だけ描いて使い回す。動きは transform だけ（GPU で動くので滑らか）。
// 毎フレーム描き直すのは、動いている先頭の帯（数列ぶん）の文字だけ。

const WIPE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-*/%^=~!()[]{}<>|&?:;@#$`'\",._░▒▓█";
const CELL_W = 9;
const CELL_H = 17;
const FONT = "15px 'JetBrains Mono ABC', monospace";
let field: { cv: HTMLCanvasElement; w: number; h: number; dpr: number } | null = null;
let curtain: HTMLElement | null = null;

const randChar = () => WIPE_CHARS[Math.floor(Math.random() * WIPE_CHARS.length)];

function palette(bright: boolean): string {
  const vivid = [theme.attr.Diagonal[0], theme.attr.Mixed[0], theme.attr.Curved[0], theme.attr.Orthogonal[0]];
  if (bright) return Math.random() < 0.7 ? vivid[Math.floor(Math.random() * vivid.length)] : theme.fg;
  return Math.random() < 0.18 ? vivid[Math.floor(Math.random() * vivid.length)] : theme.faint;
}

/** 画面いっぱいの文字の面（ウィンドウの大きさが変わったときだけ描き直す） */
function getField(): HTMLCanvasElement {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (field && field.w === w && field.h === h && field.dpr === dpr) return field.cv;
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(w * dpr);
  cv.height = Math.ceil(h * dpr);
  const g = cv.getContext("2d")!;
  g.scale(dpr, dpr);
  g.fillStyle = theme.bg;
  g.fillRect(0, 0, w, h);
  g.font = FONT;
  g.textBaseline = "top";
  for (let y = 0; y < h; y += CELL_H)
    for (let x = 0; x < w; x += CELL_W) {
      g.fillStyle = palette(false);
      g.fillText(randChar(), x, y);
    }
  field = { cv, w, h, dpr };
  return cv;
}

/** 先頭の帯の文字を描き直す（明るい色でパラパラさせる）。side は帯が面のどちら側か */
function scrambleEdge(edge: HTMLCanvasElement, side: "left" | "right"): void {
  const g = edge.getContext("2d")!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = edge.width / dpr;
  const h = edge.height / dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = FONT;
  g.textBaseline = "top";
  const cols = Math.floor(w / CELL_W);
  for (let y = 0; y < h; y += CELL_H)
    for (let c = 0; c < cols; c++) {
      // 先頭ほど文字が多く明るい
      const k = side === "right" ? c / cols : 1 - c / cols;
      if (Math.random() > 0.25 + k * 0.7) continue;
      g.globalAlpha = 0.35 + k * 0.65;
      g.fillStyle = palette(true);
      g.fillText(randChar(), c * CELL_W, y);
    }
  g.globalAlpha = 1;
}

function buildCurtain(side: "left" | "right"): { el: HTMLElement; edge: HTMLCanvasElement } {
  const el = document.createElement("div");
  el.className = `fx-curtain edge-${side}`;
  el.appendChild(getField());
  const edge = document.createElement("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const bandW = CELL_W * 14;
  edge.className = "fx-edge";
  edge.width = Math.ceil(bandW * dpr);
  edge.height = Math.ceil(window.innerHeight * dpr);
  edge.style.width = `${bandW}px`;
  edge.style.height = `${window.innerHeight}px`;
  el.appendChild(edge);
  const glow = document.createElement("div");
  glow.className = "fx-glow";
  el.appendChild(glow);
  document.body.appendChild(el);
  return { el, edge };
}

async function slide(el: HTMLElement, edge: HTMLCanvasElement, side: "left" | "right", from: string, to: string): Promise<void> {
  scrambleEdge(edge, side);
  const timer = setInterval(() => scrambleEdge(edge, side), 45);
  const anim = el.animate([{ transform: from }, { transform: to }], {
    duration: FX.wipe.ms / sp(),
    easing: "cubic-bezier(.7,0,.3,1)",
    fill: "forwards",
  });
  await anim.finished.catch(() => {});
  clearInterval(timer);
}

/** 画面を文字で覆う（次の画面を作る前に呼ぶ）。左から右へ流れ込む */
export async function cover(): Promise<void> {
  if (curtain) return;
  const { el, edge } = buildCurtain("right");
  curtain = el;
  await slide(el, edge, "right", "translateX(-100%)", "translateX(0)");
  edge.remove();
  await wait(FX.wipe.hold / sp());
}

/** 覆いを外す（右へ抜けていく） */
export async function uncover(): Promise<void> {
  const c = curtain;
  if (!c) return;
  curtain = null;
  c.remove();
  const { el, edge } = buildCurtain("left");
  await slide(el, edge, "left", "translateX(0)", "translateX(100%)");
  el.remove();
}

/** 最初の切り替えで固まらないよう、文字の面を先に描いておく */
export function prepareWipe(): void {
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
  if (idle) idle(() => getField());
  else setTimeout(() => getField(), 200);
}
