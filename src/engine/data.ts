// カードとルールのデータ（JSON）を型付きで読み込む。
import config from "../data/config.json" with { type: "json" };
import unitsJson from "../data/units.json" with { type: "json" };
import symbolsJson from "../data/symbols.json" with { type: "json" };
import attributesJson from "../data/attributes.json" with { type: "json" };
import decksJson from "../data/decks.json" with { type: "json" };
import type { Attr, DeckList } from "./types.ts";

export type Rules = typeof config.rules;
export type DeckRules = typeof config.deck;

export interface Op {
  op: string;
  [k: string]: unknown;
}

export interface SkillForm {
  short: string;
  text: string;
  ops: Op[];
}

export interface UnitDef {
  attr: Attr;
  hp: number;
  atk: number;
  skill: { name: string; cost: number; lower: SkillForm; upper: SkillForm };
}

export interface SymbolDef {
  label: string;
  name: string;
  short: string;
  text: string;
  free?: boolean;
  ops: Op[];
}

export interface AttrDef {
  label: string;
  ja: string;
  shape: string;
  icon: string;
  hpBonus: number;
  atkBonus: number;
  endTurnHeal: number;
  ruleText: string;
}

function withoutComment<T>(obj: Record<string, unknown>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(obj)) if (!(k.startsWith("_") && k.length > 1)) out[k] = v as T;
  return out;
}

export const UNITS = withoutComment<UnitDef>(unitsJson);
export const SYMBOLS = withoutComment<SymbolDef>(symbolsJson);
export const ATTRS = withoutComment<AttrDef>(attributesJson) as Record<Attr, AttrDef>;
export const LETTERS = Object.keys(UNITS);
export const SYMBOL_IDS = Object.keys(SYMBOLS);

export const DEFAULT_RULES: Rules = config.rules;
export const DECK_RULES: DeckRules = config.deck;

export interface DeckPreset extends DeckList {
  id: string;
  name: string;
  note: string;
}
export const DECK_PRESETS: DeckPreset[] = decksJson.presets;
export const DEFAULT_PRESET = decksJson.default;

export function mergeRules(over?: Partial<Rules>): Rules {
  return { ...structuredClone(DEFAULT_RULES), ...(over ? structuredClone(over) : {}) };
}

/** デックの構成チェック。問題があればメッセージのキーと値を返す */
export function validateDeck(list: DeckList, deck: DeckRules = DECK_RULES): string[] {
  const errors: string[] = [];
  if (list.units.length !== deck.unitCount) errors.push(`units:${list.units.length}/${deck.unitCount}`);
  if (list.symbols.length !== deck.symbolCount) errors.push(`symbols:${list.symbols.length}/${deck.symbolCount}`);
  for (const u of list.units) if (!UNITS[u]) errors.push(`unknownUnit:${u}`);
  for (const s of list.symbols) if (!SYMBOLS[s]) errors.push(`unknownSymbol:${s}`);
  const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
  for (const [u, n] of count(list.units)) if (n > deck.maxSameUnit) errors.push(`dupUnit:${u}`);
  for (const [s, n] of count(list.symbols)) if (n > deck.maxSameSymbol) errors.push(`dupSymbol:${s}`);
  return errors;
}
