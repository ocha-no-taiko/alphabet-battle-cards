// 状態を読むだけの関数（ATK・自動ダメージ・コスト・支払い・操作の可否など）。
import { ATTRS, SYMBOLS, UNITS, type SkillForm, type UnitDef } from "./data.ts";
import type { Card, Effect, EffectKind, GameState, PlayerId, UnitCard } from "./types.ts";

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export function card(s: GameState, id: number): Card {
  const c = s.cards[id];
  if (!c) throw new Error(`no card ${id}`);
  return c;
}

export function unitCard(s: GameState, id: number | null): UnitCard | null {
  if (id === null) return null;
  const c = s.cards[id];
  return c && c.kind === "unit" ? c : null;
}

export function unitDef(c: UnitCard): UnitDef {
  return UNITS[c.letter];
}

export function freshUnitState(letter: string) {
  const d = UNITS[letter];
  return { hp: d.hp, maxHp: d.hp, evolved: false, tenure: 0, evoShift: 0 };
}

/** 進化で増える HP / ATK（共通 +5 と属性の固有ルール） */
export function evolveGain(s: GameState, c: UnitCard): { hp: number; atk: number } {
  const a = ATTRS[unitDef(c).attr];
  return { hp: s.rules.evolveBonus.hp + a.hpBonus, atk: s.rules.evolveBonus.atk + a.atkBonus };
}

export function unitAtk(s: GameState, c: UnitCard): number {
  const base = unitDef(c).atk;
  return c.unit.evolved ? base + evolveGain(s, c).atk : base;
}

export function skillForm(c: UnitCard): SkillForm {
  const sk = unitDef(c).skill;
  return c.unit.evolved ? sk.upper : sk.lower;
}

export function displayLetter(c: UnitCard): string {
  return c.unit.evolved ? c.letter.toUpperCase() : c.letter.toLowerCase();
}

// ---- 継続効果 ----

export function isActive(s: GameState, e: Effect): boolean {
  return e.kind === "storageCap" || s.current === e.on;
}

export function activeEffects(s: GameState, kind: EffectKind, owner?: PlayerId, on?: PlayerId): Effect[] {
  return s.effects.filter(
    (e) => e.kind === kind && isActive(s, e) && (owner === undefined || e.owner === owner) && (on === undefined || e.on === on),
  );
}

export function sumEffect(s: GameState, kind: EffectKind, owner?: PlayerId, on?: PlayerId): number {
  return activeEffects(s, kind, owner, on).reduce((a, e) => a + e.value, 0);
}

export function isSealed(s: GameState, p: PlayerId, kind: "sealSymbol" | "sealStorage" | "sealMainSkill"): boolean {
  return activeEffects(s, kind, undefined, p).length > 0;
}

export function storageCap(s: GameState, p: PlayerId): number {
  return s.rules.storageMax + sumEffect(s, "storageCap", p);
}

// ---- 位置 ----

export type Zone = "deck" | "hand" | "trash" | "storage" | "main" | "sub" | "pool" | "resolving";

export function locate(s: GameState, id: number): { p: PlayerId; zone: Zone; index: number } | null {
  for (const p of [0, 1] as PlayerId[]) {
    const pl = s.players[p];
    if (pl.main === id) return { p, zone: "main", index: 0 };
    if (pl.resolving === id) return { p, zone: "resolving", index: 0 };
    for (const zone of ["subs", "hand", "storage", "trash", "deck", "pool"] as const) {
      const i = pl[zone].indexOf(id);
      if (i >= 0) return { p, zone: zone === "subs" ? "sub" : zone, index: i };
    }
  }
  return null;
}

export function fieldUnits(s: GameState, p: PlayerId): UnitCard[] {
  const pl = s.players[p];
  const ids = pl.main === null ? pl.subs : [pl.main, ...pl.subs];
  return ids.map((id) => unitCard(s, id)).filter((c): c is UnitCard => c !== null);
}

/** 進化に必要な在籍ターン（位置で変わる） */
export function evoThreshold(s: GameState, c: UnitCard, zone: "main" | "sub"): number {
  return s.rules.evolveTurns[zone] + c.unit.evoShift;
}

export function evoRemaining(s: GameState, id: number): number | null {
  const c = unitCard(s, id);
  const loc = locate(s, id);
  if (!c || c.unit.evolved || !loc || (loc.zone !== "main" && loc.zone !== "sub")) return null;
  return Math.max(0, evoThreshold(s, c, loc.zone) - c.unit.tenure);
}

// ---- 自動ダメージ ----

export interface AutoBreakdown {
  main: number;
  subs: number;
  mult: number;
  subPart: number;
  bonus: number;
  minus: number;
  total: number;
}

export function subMultiplier(s: GameState, p: PlayerId): number {
  if (s.current === p && s.turn.subMult !== null) return s.turn.subMult; // 「*」は自分のターン中に上書き
  const set = activeEffects(s, "subMultSet", undefined, p);
  if (set.length) return Math.min(...set.map((e) => e.value));
  return s.rules.subMultiplier;
}

export function autoDamage(s: GameState, p: PlayerId): AutoBreakdown {
  const pl = s.players[p];
  const mainCard = unitCard(s, pl.main);
  const main = mainCard ? unitAtk(s, mainCard) : 0;
  const subs = pl.subs.reduce((a, id) => a + unitAtk(s, unitCard(s, id)!), 0);
  const mult = subMultiplier(s, p);
  const subPart = Math.ceil(subs * mult - 1e-9);
  const bonus = s.current === p ? s.turn.autoBonus : 0;
  const minus = sumEffect(s, "autoMinus", undefined, p);
  const total = Math.max(0, main + subPart + bonus - minus);
  return { main, subs, mult, subPart, bonus, minus, total };
}

// ---- 技のコストと支払い ----

export function skillCost(s: GameState, p: PlayerId, unitId: number): number {
  const c = unitCard(s, unitId);
  if (!c) return Infinity;
  const base = unitDef(c).skill.cost;
  const up = sumEffect(s, "costUp", undefined, p);
  const down = s.current === p ? s.turn.costReduce : 0;
  return Math.max(0, base + up - down);
}

export function paymentValue(s: GameState, id: number): number {
  const c = card(s, id);
  if (c.kind !== "num") return 0;
  return c.value + (s.turn.boostCard === id && c.value !== 0 ? s.turn.boostAmount : 0);
}

function satisfies(s: GameState, ids: number[], cost: number): boolean {
  if (ids.some((id) => (s.cards[id] as { value?: number }).value === 0)) return true;
  return ids.reduce((a, id) => a + paymentValue(s, id), 0) >= cost;
}

/** 支払いの判定。合計がコスト以上（または 0 を含む）で、どの 1 枚を抜いても足りなくなること（余分な札を出さない） */
export function isValidPayment(s: GameState, p: PlayerId, ids: number[], cost: number): boolean {
  if (new Set(ids).size !== ids.length) return false;
  const storage = s.players[p].storage;
  if (!ids.every((id) => storage.includes(id))) return false;
  if (cost <= 0) return ids.length === 0;
  if (ids.length === 0 || !satisfies(s, ids, cost)) return false;
  return ids.every((_, i) => !satisfies(s, ids.filter((__, j) => j !== i), cost));
}

/** おすすめの支払い。無駄（お釣り）が少なく、0 をなるべく温存する組み合わせ */
export function autoPay(s: GameState, p: PlayerId, cost: number): number[] | null {
  if (cost <= 0) return [];
  const storage = s.players[p].storage;
  let best: number[] | null = null;
  let bestScore = Infinity;
  for (let mask = 1; mask < 1 << storage.length; mask++) {
    const ids = storage.filter((_, i) => mask & (1 << i));
    if (!isValidPayment(s, p, ids, cost)) continue;
    const hasZero = ids.some((id) => (s.cards[id] as { value?: number }).value === 0);
    const waste = hasZero ? 0 : ids.reduce((a, id) => a + paymentValue(s, id), 0) - cost;
    const score = waste * 10 + (hasZero ? 25 : 0) + ids.length;
    if (score < bestScore) {
      bestScore = score;
      best = ids;
    }
  }
  return best;
}

export function canAfford(s: GameState, p: PlayerId, cost: number): boolean {
  return autoPay(s, p, cost) !== null;
}

// ---- 操作の可否（エラーは text.json の err.* のキー） ----

function turnCheck(s: GameState, p: PlayerId): string | null {
  if (s.phase === "over") return "gameOver";
  if (s.phase !== "main") return "phase";
  if (s.pending.length) return "pending";
  if (s.current !== p) return "notYourTurn";
  return null;
}

export function canPlace(s: GameState, p: PlayerId, id: number): string | null {
  const e = turnCheck(s, p);
  if (e) return e;
  const pl = s.players[p];
  const c = s.cards[id];
  if (!pl.hand.includes(id)) return "notInHand";
  if (!c || c.kind !== "num") return "notNumber";
  if (isSealed(s, p, "sealStorage")) return "sealStorage";
  if (s.turn.numbersPlaced >= s.turn.numbersAllowed) return "numberLimit";
  if (pl.storage.length >= storageCap(s, p)) return "storageFull";
  return null;
}

export function canUseSkill(s: GameState, p: PlayerId, unitId: number): string | null {
  const e = turnCheck(s, p);
  if (e) return e;
  const pl = s.players[p];
  if (pl.main !== unitId && !pl.subs.includes(unitId)) return "notOnField";
  if (s.turn.skillsUsed >= s.turn.skillsAllowed) return "skillLimit";
  if (pl.main === unitId && isSealed(s, p, "sealMainSkill")) return "sealMainSkill";
  if (!canAfford(s, p, skillCost(s, p, unitId))) return "cannotPay";
  return null;
}

export function canUseSymbol(s: GameState, p: PlayerId, id: number): string | null {
  const e = turnCheck(s, p);
  if (e) return e;
  const c = s.cards[id];
  if (!s.players[p].hand.includes(id)) return "notInHand";
  if (!c || c.kind !== "sym") return "notSymbol";
  if (isSealed(s, p, "sealSymbol")) return "sealSymbol";
  if (!SYMBOLS[c.sym].free && s.turn.symbolsUsed >= s.turn.symbolsAllowed) return "symbolLimit";
  return null;
}

export function canEndTurn(s: GameState, p: PlayerId): string | null {
  return turnCheck(s, p);
}

/** 撃破されたあと、新しいメインにできるユニット（サブ・ハンド） */
export function mainCandidates(s: GameState, p: PlayerId): number[] {
  const pl = s.players[p];
  return [...pl.subs, ...pl.hand.filter((id) => s.cards[id].kind === "unit")];
}

/** いま操作を待っているプレイヤー（準備中は未決定の側をすべて返す） */
export function waitingFor(s: GameState): PlayerId[] {
  if (s.phase === "over") return [];
  if (s.phase === "setup") return ([0, 1] as PlayerId[]).filter((p) => !s.players[p].setup);
  if (s.pending.length) return [s.pending[0].player];
  return [s.current];
}
