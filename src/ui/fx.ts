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

let curtain: HTMLElement | null = null;
const WIPE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-*/%^=~!()[]{}<>|&?:;@#$`'\",._░▒▓█";

function fill(pre: HTMLElement): void {
  const cols = Math.ceil(window.innerWidth / 9) + 2;
  const rows = Math.ceil(window.innerHeight / 17) + 2;
  const palette = [theme.attr.Diagonal[0], theme.attr.Mixed[0], theme.attr.Curved[0], theme.attr.Orthogonal[0], theme.faint, theme.faint, theme.faint];
  let html = "";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = WIPE_CHARS[Math.floor(Math.random() * WIPE_CHARS.length)];
      const col = palette[Math.floor(Math.random() * palette.length)];
      html += `<span style="color:${col}">${c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c}</span>`;
    }
    html += "\n";
  }
  pre.innerHTML = html;
}

/** 画面を文字で覆う（次の画面を作る前に呼ぶ） */
export async function cover(): Promise<void> {
  if (curtain) return;
  curtain = document.createElement("div");
  curtain.className = "fx-curtain";
  const pre = document.createElement("pre");
  curtain.appendChild(pre);
  document.body.appendChild(curtain);
  fill(pre);
  const timer = setInterval(() => fill(pre), 60);
  const ms = FX.wipe.ms / sp();
  const a = curtain.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }], { duration: ms, easing: "cubic-bezier(.7,0,.3,1)", fill: "forwards" });
  await a.finished.catch(() => {});
  await wait(FX.wipe.hold / sp());
  clearInterval(timer);
}

/** 覆いを外す */
export async function uncover(): Promise<void> {
  const c = curtain;
  if (!c) return;
  curtain = null;
  const pre = c.querySelector("pre") as HTMLElement;
  const timer = setInterval(() => fill(pre), 60);
  const a = c.animate([{ clipPath: "inset(0 0 0 0%)" }, { clipPath: "inset(0 0 0 100%)" }], { duration: FX.wipe.ms / sp(), easing: "cubic-bezier(.7,0,.3,1)", fill: "forwards" });
  await a.finished.catch(() => {});
  clearInterval(timer);
  c.remove();
}
