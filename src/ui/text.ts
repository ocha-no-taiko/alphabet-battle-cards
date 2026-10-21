// 文言の差し込み（text.json の {x} を置き換える）とカードの短い名前。
import { SYMBOLS } from "../engine/data.ts";
import type { Card } from "../engine/types.ts";

export function fmt(tpl: string, vars: Record<string, unknown> = {}): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function cardName(c: Card): string {
  if (c.kind === "num") return String(c.value);
  if (c.kind === "sym") return SYMBOLS[c.sym].label;
  return c.unit.evolved ? c.letter.toUpperCase() : c.letter.toLowerCase();
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
