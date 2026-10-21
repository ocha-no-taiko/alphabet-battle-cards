// カラーアスキーアート。文字と色の 2 次元配列（Art）を作り、HTML（<pre> の span）か Canvas（Three.js のテクスチャ）に描く。
import glyphsJson from "../data/glyphs.json" with { type: "json" };
import theme from "../data/theme.json" with { type: "json" };
import { ATTRS, SYMBOLS, UNITS } from "../engine/data.ts";
import { evoThreshold, unitAtk } from "../engine/query.ts";
import type { Card, GameState, UnitCard } from "../engine/types.ts";

const GLYPHS = glyphsJson as unknown as Record<string, string[]>;

export interface Art {
  w: number;
  h: number;
  ch: string[][];
  co: string[][];
  bg?: string;
}

export const CARD_W = 15;
export const CARD_H = 12;

export function blank(w: number, h: number, bg?: string): Art {
  return {
    w,
    h,
    ch: Array.from({ length: h }, () => Array(w).fill(" ")),
    co: Array.from({ length: h }, () => Array(w).fill(theme.fg)),
    bg,
  };
}

export function put(a: Art, x: number, y: number, text: string, color: string | ((i: number) => string)): void {
  if (y < 0 || y >= a.h) return;
  [...text].forEach((c, i) => {
    const xx = x + i;
    if (xx < 0 || xx >= a.w) return;
    a.ch[y][xx] = c;
    a.co[y][xx] = typeof color === "string" ? color : color(i);
  });
}

export function putRight(a: Art, xEnd: number, y: number, text: string, color: string): void {
  put(a, xEnd - [...text].length + 1, y, text, color);
}

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${f(r1, r2)}${f(g1, g2)}${f(b1, b2)}`;
}

export function frame(a: Art, x: number, y: number, w: number, h: number, color: string, double = false): void {
  const [tl, tr, bl, br, hz, vt] = double ? ["╔", "╗", "╚", "╝", "═", "║"] : ["┌", "┐", "└", "┘", "─", "│"];
  put(a, x, y, tl + hz.repeat(w - 2) + tr, color);
  put(a, x, y + h - 1, bl + hz.repeat(w - 2) + br, color);
  for (let i = 1; i < h - 1; i++) {
    put(a, x, y + i, vt, color);
    put(a, x + w - 1, y + i, vt, color);
  }
}

/** 5×5 ドットの大きな文字。1 ドット = 横 2 文字。色は (行, 列) のグラデーション */
export function glyph(a: Art, x: number, y: number, key: string, c1: string, c2: string, pixel = "██"): void {
  const g = GLYPHS[key];
  if (!g) return;
  g.forEach((row, r) => {
    [...row].forEach((bit, c) => {
      if (bit !== "#") return;
      const t = (r + c * 0.35) / 6;
      put(a, x + c * 2, y + r, pixel, mix(c1, c2, Math.min(1, t)));
    });
  });
}

/** 文字列を大きなドット文字で並べた看板（タイトルや K.O. など） */
export function bannerArt(text: string, colors: [string, string][], shadow = true): Art {
  const keys = [...text];
  const widths = keys.map((k) => (k === " " ? 4 : (GLYPHS[k]?.[0].length ?? 5) * 2 + 2));
  const w = widths.reduce((x, y) => x + y, 0) + 2;
  const a = blank(w, 7);
  let x = 1;
  keys.forEach((k, i) => {
    const [c1, c2] = colors[i % colors.length];
    if (k !== " ") {
      if (shadow) glyph(a, x + 1, 1, k, theme.faint, theme.faint, "░░");
      glyph(a, x, 0, k, c1, c2);
    }
    x += widths[i];
  });
  return a;
}

// ---- カード ----

export function attrColors(attr: string): [string, string] {
  return (theme.attr as unknown as Record<string, [string, string]>)[attr] ?? [theme.fg, theme.dim];
}

function hpColor(ratio: number): string {
  return ratio > 0.6 ? theme.hp.high : ratio > 0.3 ? theme.hp.mid : theme.hp.low;
}

export interface UnitView {
  /** 場にいるときの位置（進化までの点表示に使う） */
  zone?: "main" | "sub" | null;
  state?: GameState;
}

export function unitArt(c: UnitCard, v: UnitView = {}): Art {
  const def = UNITS[c.letter];
  const attr = ATTRS[def.attr];
  const [c1, c2] = attrColors(def.attr);
  const evolved = c.unit.evolved;
  const a = blank(CARD_W, CARD_H, theme.cardBg);
  frame(a, 0, 0, CARD_W, CARD_H, evolved ? c1 : mix(c1, theme.cardBg, 0.45), evolved);
  const letter = evolved ? c.letter.toUpperCase() : c.letter.toLowerCase();
  put(a, 1, 1, letter, c1);
  put(a, 3, 1, attr.icon, c2);
  const atk = v.state ? unitAtk(v.state, c) : def.atk;
  putRight(a, 13, 1, `ATK${String(atk).padStart(3)}`, theme.fg);
  const ratio = c.unit.hp / c.unit.maxHp;
  const filled = Math.max(0, Math.min(7, Math.ceil(ratio * 7)));
  put(a, 1, 2, "HP", theme.dim);
  put(a, 4, 2, "█".repeat(filled) + "░".repeat(7 - filled), (i) => (i < filled ? hpColor(ratio) : theme.faint));
  putRight(a, 13, 2, String(Math.max(0, c.unit.hp)), hpColor(ratio));
  glyph(a, 2, 4, letter, c1, c2);
  if (evolved) put(a, 1, 9, "EVOLVED", c1);
  else if (v.zone && v.state) {
    const need = evoThreshold(v.state, c, v.zone);
    const dots = Array.from({ length: Math.min(need, 8) }, (_, i) => (i < c.unit.tenure ? "●" : "○")).join("");
    put(a, 1, 9, "EVO", theme.dim);
    put(a, 5, 9, dots, (i) => (i < c.unit.tenure ? c1 : theme.faint));
  }
  const sk = def.skill;
  put(a, 1, 10, sk.name, evolved ? c1 : theme.fg);
  putRight(a, 13, 10, `(${sk.cost})`, theme.gold);
  return a;
}

/** 数字カード。left はお釣りで減ったあとの残り（大きな文字は残りの値） */
export function numberArt(value: number, left = value): Art {
  const [c1, c2] = value === 0 ? theme.zero : theme.num;
  const a = blank(CARD_W, CARD_H, theme.cardBg);
  frame(a, 0, 0, CARD_W, CARD_H, mix(c1, theme.cardBg, 0.5));
  put(a, 1, 1, String(value), left < value ? theme.dim : c1);
  putRight(a, 13, 1, value === 0 ? "WILD" : left < value ? `LEFT ${left}` : "ENERGY", value === 0 || left < value ? c1 : theme.dim);
  glyph(a, 2, 4, String(left), c1, c2);
  if (left < value) put(a, 1, 10, `${value}-${value - left}`, theme.dim);
  putRight(a, 13, 10, String(left), c1);
  if (value === 0) put(a, 1, 10, "ANY COST", theme.dim);
  return a;
}

export function symbolArt(sym: string): Art {
  const d = SYMBOLS[sym];
  const [c1, c2] = theme.sym as [string, string];
  const a = blank(CARD_W, CARD_H, theme.cardBg);
  frame(a, 0, 0, CARD_W, CARD_H, mix(c1, theme.cardBg, 0.5));
  put(a, 1, 1, d.label, c1);
  putRight(a, 13, 1, "SYMBOL", theme.dim);
  glyph(a, 2, 3, sym, c1, c2);
  put(a, 1, 9, d.name, theme.fg);
  put(a, 1, 10, d.short.slice(0, 13), c1);
  return a;
}

export function backArt(): Art {
  const [b1, b2] = theme.back as [string, string];
  const a = blank(CARD_W, CARD_H, theme.cardBg);
  frame(a, 0, 0, CARD_W, CARD_H, mix(b2, theme.cardBg, 0.3));
  for (let y = 1; y < CARD_H - 1; y++)
    for (let x = 1; x < CARD_W - 1; x++) {
      const t = (x + y) / (CARD_W + CARD_H);
      put(a, x, y, (x + y) % 2 ? "╱" : "╲", mix(b1, b2, t));
    }
  put(a, 3, 4, "┌───────┐", b2);
  put(a, 3, 5, "│       │", b2);
  put(a, 3, 6, "│       │", b2);
  put(a, 3, 7, "└───────┘", b2);
  put(a, 5, 5, "A", theme.attr.Diagonal[0]);
  put(a, 7, 5, "B", theme.attr.Mixed[0]);
  put(a, 9, 5, "C", theme.attr.Curved[0]);
  put(a, 4, 6, " ·····  ", theme.dim);
  return a;
}

/** 先攻を決めるコイン代わりのカード */
export function labelArt(big: string, label: string, color: string): Art {
  const a = blank(CARD_W, CARD_H, theme.cardBg);
  frame(a, 0, 0, CARD_W, CARD_H, color, true);
  put(a, 1, 1, label, color);
  glyph(a, 2, 4, big, color, theme.fg);
  putRight(a, 13, 10, "FIRST", theme.dim);
  return a;
}

export function cardArt(c: Card, v: UnitView = {}): Art {
  if (c.kind === "unit") return unitArt(c, v);
  if (c.kind === "num") return numberArt(c.value, c.value - (c.spent ?? 0));
  return symbolArt(c.sym);
}

// ---- 出力 ----

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function artToHtml(a: Art): string {
  const lines: string[] = [];
  for (let y = 0; y < a.h; y++) {
    let line = "";
    let run = "";
    let color = "";
    for (let x = 0; x < a.w; x++) {
      const c = a.co[y][x];
      if (c !== color && run) {
        line += `<span style="color:${color}">${esc(run)}</span>`;
        run = "";
      }
      color = c;
      run += a.ch[y][x];
    }
    if (run) line += `<span style="color:${color}">${esc(run)}</span>`;
    lines.push(line);
  }
  return lines.join("\n");
}

export function artKey(a: Art): string {
  return a.ch.map((r) => r.join("")).join("\n") + a.co.map((r) => r.join("")).join("");
}

export const FONT_FAMILY = "'JetBrains Mono ABC', 'Menlo', monospace";

/** Canvas に描く（Three.js のテクスチャ用）。1 文字のセルは 0.6em × 1.2em */
export function artToCanvas(a: Art, fontPx = 26): HTMLCanvasElement {
  const cw = fontPx * 0.6;
  const lh = fontPx * 1.2;
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(a.w * cw);
  cv.height = Math.ceil(a.h * lh);
  const g = cv.getContext("2d")!;
  g.fillStyle = a.bg ?? theme.cardBg;
  g.fillRect(0, 0, cv.width, cv.height);
  g.font = `${fontPx}px ${FONT_FAMILY}`;
  g.textBaseline = "middle";
  g.textAlign = "center";
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const ch = a.ch[y][x];
      if (ch === " ") continue;
      g.fillStyle = a.co[y][x];
      // 罫線とブロックはセルいっぱいに描く（フォントの描画だと継ぎ目が出るため）
      if (!drawBlock(g, ch, x * cw, y * lh, cw, lh)) g.fillText(ch, x * cw + cw / 2, y * lh + lh / 2 + fontPx * 0.04);
    }
  return cv;
}

function drawBlock(g: CanvasRenderingContext2D, ch: string, x: number, y: number, w: number, h: number): boolean {
  const t = Math.max(1.5, w * 0.13);
  const mx = x + w / 2;
  const my = y + h / 2;
  const hl = (x0: number, x1: number, yy = my, th = t) => g.fillRect(x0, yy - th / 2, x1 - x0, th);
  const vl = (y0: number, y1: number, xx = mx, th = t) => g.fillRect(xx - th / 2, y0, th, y1 - y0);
  switch (ch) {
    case "█": g.fillRect(x, y, w + 0.5, h + 0.5); return true;
    case "░": g.globalAlpha = 0.35; g.fillRect(x, y, w + 0.5, h + 0.5); g.globalAlpha = 1; return true;
    case "─": hl(x, x + w + 0.5); return true;
    case "│": vl(y, y + h + 0.5); return true;
    case "┌": hl(mx - t / 2, x + w + 0.5); vl(my - t / 2, y + h + 0.5); return true;
    case "┐": hl(x, mx + t / 2); vl(my - t / 2, y + h + 0.5); return true;
    case "└": hl(mx - t / 2, x + w + 0.5); vl(y, my + t / 2); return true;
    case "┘": hl(x, mx + t / 2); vl(y, my + t / 2); return true;
    case "═": hl(x, x + w + 0.5, my - t * 1.2); hl(x, x + w + 0.5, my + t * 1.2); return true;
    case "║": vl(y, y + h + 0.5, mx - t * 1.2); vl(y, y + h + 0.5, mx + t * 1.2); return true;
    case "╔": hl(mx - t * 1.2, x + w + 0.5, my - t * 1.2); hl(mx + t * 1.2, x + w + 0.5, my + t * 1.2);
      vl(my - t * 1.2, y + h + 0.5, mx - t * 1.2); vl(my + t * 1.2, y + h + 0.5, mx + t * 1.2); return true;
    case "╗": hl(x, mx + t * 1.2, my - t * 1.2); hl(x, mx - t * 1.2, my + t * 1.2);
      vl(my - t * 1.2, y + h + 0.5, mx + t * 1.2); vl(my + t * 1.2, y + h + 0.5, mx - t * 1.2); return true;
    case "╚": hl(mx - t * 1.2, x + w + 0.5, my + t * 1.2); hl(mx + t * 1.2, x + w + 0.5, my - t * 1.2);
      vl(y, my + t * 1.2, mx - t * 1.2); vl(y, my - t * 1.2, mx + t * 1.2); return true;
    case "╝": hl(x, mx + t * 1.2, my + t * 1.2); hl(x, mx - t * 1.2, my - t * 1.2);
      vl(y, my + t * 1.2, mx + t * 1.2); vl(y, my - t * 1.2, mx - t * 1.2); return true;
  }
  return false;
}
