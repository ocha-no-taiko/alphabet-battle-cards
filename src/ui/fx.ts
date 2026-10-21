// 画面全体の演出（揺れ・フラッシュ・火花・画面切り替えのワイプ）。強さと長さは fx.json で調整する。
import fxJson from "../data/fx.json" with { type: "json" };
import theme from "../data/theme.json" with { type: "json" };
import { prefs } from "./prefs.ts";

export const FX = fxJson;
const sp = () => Math.max(0.5, prefs.speed);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * アニメーションの終わりを待つ。ただし ms を過ぎたら待たずに進む
 * （画面が隠れていてアニメーションが止まっていても、対戦や画面切り替えが止まらないように）
 */
export function finished(anim: Animation, ms: number): Promise<void> {
  return Promise.race([anim.finished.then(() => {}, () => {}), wait(ms + 150)]);
}

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
// 見た目: 画面いっぱいの文字がチラチラ変わり続け、文字はその場のまま境目だけが横に動く。
// 軽くするしくみ:
// ・文字の面は Canvas に 2 枚だけ描いて使い回す（起動直後の空き時間に描く）。チラチラは、見せる面とずらす量を
//   毎回ランダムに変えて作る（描き直さないので、1 回の切り替えは数十マイクロ秒）
// ・境目の動きは「外枠を右へ、中身を左へ同じだけ」動かす。どちらも transform なので GPU だけで動く

const WIPE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-*/%^=~!()[]{}<>|&?:;@#$`'\",._░▒▓█";
const CELL_W = 9;
const CELL_H = 17;
const PAD = 8; // ずらせる量（セル数）。面はこのぶん画面より大きく描く
const FONT = "15px 'JetBrains Mono ABC', monospace";
const FIELD_COUNT = 2;
let fields: { cv: HTMLCanvasElement; key: string }[] = [];
let curtain: { el: HTMLElement; inner: HTMLElement } | null = null;

const dprNow = () => Math.min(2, window.devicePixelRatio || 1);
const sizeKey = () => `${window.innerWidth}x${window.innerHeight}@${dprNow()}`;

function drawField(): HTMLCanvasElement {
  const w = window.innerWidth + PAD * CELL_W;
  const h = window.innerHeight + PAD * CELL_H;
  const dpr = dprNow();
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(w * dpr);
  cv.height = Math.ceil(h * dpr);
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  const g = cv.getContext("2d")!;
  g.scale(dpr, dpr);
  g.fillStyle = theme.bg;
  g.fillRect(0, 0, w, h);
  g.font = FONT;
  g.textBaseline = "top";
  const pal = [theme.attr.Diagonal[0], theme.attr.Mixed[0], theme.attr.Curved[0], theme.attr.Orthogonal[0], theme.faint, theme.faint, theme.faint];
  for (let y = 0; y < h; y += CELL_H)
    for (let x = 0; x < w; x += CELL_W) {
      g.fillStyle = pal[Math.floor(Math.random() * pal.length)];
      g.fillText(WIPE_CHARS[Math.floor(Math.random() * WIPE_CHARS.length)], x, y);
    }
  return cv;
}

/** 文字の面をそろえる（大きさが変わっていたら描き直す）。足りないぶんだけ描く */
function ensureFields(count = FIELD_COUNT): HTMLCanvasElement[] {
  const key = sizeKey();
  fields = fields.filter((f) => f.key === key);
  while (fields.length < count) fields.push({ cv: drawField(), key });
  return fields.map((f) => f.cv);
}

function startFlicker(inner: HTMLElement): () => void {
  const cvs = [...inner.querySelectorAll("canvas")];
  const tick = () => {
    const pick = Math.floor(Math.random() * cvs.length);
    const ox = Math.floor(Math.random() * PAD) * CELL_W;
    const oy = Math.floor(Math.random() * PAD) * CELL_H;
    cvs.forEach((c, i) => {
      c.style.visibility = i === pick ? "visible" : "hidden";
      if (i === pick) c.style.transform = `translate(${-ox}px, ${-oy}px)`;
    });
  };
  tick();
  const timer = setInterval(tick, FX.wipe.flickerMs);
  return () => clearInterval(timer);
}

/** 外枠と中身を逆向きに動かして、境目だけが動いて見えるようにする */
async function sweep(c: { el: HTMLElement; inner: HTMLElement }, from: number, to: number): Promise<void> {
  const opts: KeyframeAnimationOptions = { duration: FX.wipe.ms / sp(), easing: "cubic-bezier(.7,0,.3,1)", fill: "forwards" };
  const a = c.el.animate([{ transform: `translateX(${from}%)` }, { transform: `translateX(${to}%)` }], opts);
  c.inner.animate([{ transform: `translateX(${-from}%)` }, { transform: `translateX(${-to}%)` }], opts);
  await finished(a, FX.wipe.ms / sp());
}

/** 画面を文字で覆う（次の画面を作る前に呼ぶ）。左から右へ覆っていく */
export async function cover(): Promise<void> {
  if (curtain) return;
  const el = document.createElement("div");
  el.className = "fx-curtain";
  const inner = document.createElement("div");
  inner.className = "fx-inner";
  for (const cv of ensureFields(1)) inner.appendChild(cv);
  el.appendChild(inner);
  document.body.appendChild(el);
  curtain = { el, inner };
  const stop = startFlicker(inner);
  await sweep(curtain, -100, 0);
  await wait(FX.wipe.hold / sp());
  stop();
}

/** 覆いを外す（左から右へ抜けていく） */
export async function uncover(): Promise<void> {
  const c = curtain;
  if (!c) return;
  curtain = null;
  // 2 枚目が描けていれば足す（チラチラの種類が増える）
  for (const cv of fields.map((f) => f.cv)) if (!cv.parentElement) c.inner.appendChild(cv);
  const stop = startFlicker(c.inner);
  await sweep(c, 0, 100);
  stop();
  c.el.remove();
}

/** 最初の切り替えで固まらないよう、文字の面を空いている時間に 1 枚ずつ描いておく */
export function prepareWipe(): void {
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200));
  const step = () => {
    if (ensureFields(Math.min(FIELD_COUNT, fields.length + 1)).length < FIELD_COUNT) idle(step);
  };
  idle(step);
}
