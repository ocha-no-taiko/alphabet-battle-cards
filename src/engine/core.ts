// 状態を書き換える基本操作（引く・ダメージ・撃破・進化・ターン進行）。
// どれも Ctx の状態（applyAction が複製したもの）を直接書き換え、イベントを積む。
import { ATTRS } from "./data.ts";
import {
  activeEffects, autoDamage, card, changeCard, evoThreshold, paymentValue, evolveGain, fieldUnits, freshUnitState, mainCandidates, other,
  sumEffect, unitCard, unitDef,
} from "./query.ts";
import { shuffle } from "./rng.ts";
import type { Card, Effect, GameEvent, GameState, PlayerId, Step, TurnState, UnitCard } from "./types.ts";

export interface Ctx {
  s: GameState;
  events: GameEvent[];
  trace: boolean;
}

export function emit(cx: Ctx, ev: GameEvent): void {
  if (cx.trace) ev.snap = structuredClone(cx.s);
  cx.events.push(ev);
}

export function freshTurn(s: GameState): TurnState {
  return {
    skillsUsed: 0,
    skillsAllowed: s.rules.skillsPerTurn,
    symbolsUsed: 0,
    symbolsAllowed: s.rules.symbolsPerTurn,
    numbersPlaced: 0,
    numbersAllowed: s.rules.numbersPerTurn,
    autoBonus: 0,
    subMult: null,
    costReduce: 0,
    boostCard: null,
    boostAmount: 0,
  };
}

/** カードをトラッシュへ。ユニットは進化と在籍ターンをリセットする（小文字・HP 満タンに戻る） */
export function resetCard(c: Card): void {
  if (c.kind === "unit") c.unit = freshUnitState(c.letter);
  if (c.kind === "num") delete c.spent;
}

/** 技の支払い。お釣りありなら余りをいちばん大きいカードに残し、ほかはトラッシュへ */
export function payCost(cx: Ctx, p: PlayerId, ids: number[], cost: number): void {
  const s = cx.s;
  const pl = s.players[p];
  if (!ids.length) return;
  const change = changeCard(s, ids, cost);
  let kept: { id: number; left: number; used: number } | undefined;
  if (change) {
    const c = card(s, change.id);
    // # の +2 から先に使う。使った分はカードに記録する
    const boost = s.turn.boostCard === change.id ? s.turn.boostAmount : 0;
    const used = paymentValue(s, change.id) - change.left;
    const fromBoost = Math.min(boost, used);
    if (c.kind === "num") c.spent = (c.spent ?? 0) + used - fromBoost;
    if (fromBoost > 0) s.turn.boostCard = null;
    // 残りは # を外した値（ターンが終わると +2 は消えるため）
    kept = { id: change.id, left: paymentValue(s, change.id) - (s.turn.boostCard === change.id ? boost : 0), used };
  }
  const gone = ids.filter((id) => id !== kept?.id);
  pl.storage = pl.storage.filter((id) => !gone.includes(id));
  for (const id of gone) toTrash(s, p, id);
  emit(cx, { t: "pay", p, ids: gone, kept });
}

export function toTrash(s: GameState, p: PlayerId, id: number): void {
  resetCard(card(s, id));
  s.players[p].trash.push(id);
}

/** 1 枚引く。デックが尽きていたらトラッシュを戻してシャッフルする */
export function drawOne(cx: Ctx, p: PlayerId, unitToSub: boolean): number | null {
  const s = cx.s;
  const pl = s.players[p];
  if (pl.deck.length === 0) {
    if (pl.trash.length === 0) {
      emit(cx, { t: "deckEmpty", p });
      return null;
    }
    const n = pl.trash.length;
    pl.deck = shuffle(s, pl.trash.splice(0));
    emit(cx, { t: "reshuffle", p, count: n });
  }
  const id = pl.deck.shift()!;
  const c = card(s, id);
  const toSub = unitToSub && c.kind === "unit" && pl.subs.length < s.rules.subSlots;
  if (toSub) pl.subs.push(id);
  else pl.hand.push(id);
  emit(cx, { t: "draw", p, id, toSub });
  return id;
}

export function addEffect(cx: Ctx, e: Effect): void {
  const s = cx.s;
  // 封じは重ねず、長いほうを採用する
  if (e.kind === "sealSymbol" || e.kind === "sealStorage" || e.kind === "sealMainSkill") {
    const same = s.effects.find((x) => x.kind === e.kind && x.on === e.on);
    if (same) {
      same.turns = Math.max(same.turns, e.turns);
      emit(cx, { t: "effect", p: e.owner, kind: e.kind, value: e.turns });
      return;
    }
  }
  s.effects.push(e);
  emit(cx, { t: "effect", p: e.owner, kind: e.kind, value: e.kind.startsWith("seal") ? e.turns : e.value });
}

/** ダメージ。ガードで減らし（0 未満にしない）、そのあと「半分」（切り上げ）。反射はそのあと */
export function dealDamage(cx: Ctx, target: PlayerId, raw: number, reflectable = true): number {
  const s = cx.s;
  if (s.phase === "over") return 0;
  const u = unitCard(s, s.players[target].main);
  if (!u) return 0;
  const guard = sumEffect(s, "guard", target);
  let d = Math.max(0, raw - guard);
  if (activeEffects(s, "half", target).length) d = Math.ceil(d / 2);
  u.unit.hp -= d;
  emit(cx, { t: "damage", p: target, id: u.id, amount: d, raw, reflected: !reflectable });
  checkKO(cx, target);
  if (reflectable && d > 0) {
    for (const r of activeEffects(s, "reflect", target)) {
      const back = Math.ceil(d * r.value - 1e-9);
      if (back > 0) dealDamage(cx, other(target), back, false);
    }
  }
  return d;
}

export function heal(cx: Ctx, p: PlayerId, id: number | null, amount: number): number {
  const u = unitCard(cx.s, id);
  if (!u || amount <= 0) return 0;
  const before = u.unit.hp;
  u.unit.hp = Math.min(u.unit.maxHp, u.unit.hp + amount);
  const healed = u.unit.hp - before;
  if (healed > 0) emit(cx, { t: "heal", p, id: u.id, amount: healed });
  return healed;
}

function gameOver(cx: Ctx, winner: PlayerId, reason: "kos" | "noUnits"): void {
  const s = cx.s;
  s.phase = "over";
  s.winner = winner;
  s.endReason = reason;
  s.pending = [];
  s.resume = [];
  emit(cx, { t: "gameOver", winner, reason });
}

export function checkKO(cx: Ctx, p: PlayerId): void {
  const s = cx.s;
  const pl = s.players[p];
  const u = unitCard(s, pl.main);
  if (!u || u.unit.hp > 0 || s.phase === "over") return;
  pl.main = null;
  toTrash(s, p, u.id);
  const winner = other(p);
  s.players[winner].kos += 1;
  emit(cx, { t: "ko", p, id: u.id });
  if (s.players[winner].kos >= s.rules.winKOs) return gameOver(cx, winner, "kos");
  if (mainCandidates(s, p).length === 0) return gameOver(cx, winner, "noUnits");
  s.pending.push({ type: "chooseMain", player: p });
}

function evolve(cx: Ctx, p: PlayerId, u: UnitCard): void {
  const g = evolveGain(cx.s, u);
  u.unit.evolved = true;
  u.unit.maxHp += g.hp;
  u.unit.hp += g.hp;
  emit(cx, { t: "evolve", p, id: u.id });
}

/** ハンドに戻ったユニットの扱い（config の returnToHand） */
export function returnUnitToHand(s: GameState, u: UnitCard): void {
  const r = s.rules.returnToHand;
  if (r.resetTenure) u.unit.tenure = 0;
  if (r.resetEvolution && u.unit.evolved) {
    const g = evolveGain(s, u);
    u.unit.evolved = false;
    u.unit.maxHp -= g.hp;
    u.unit.hp = Math.min(u.unit.hp, u.unit.maxHp);
  }
  if (r.resetHp) u.unit.hp = u.unit.maxHp;
}

// ---- ターン進行 ----

export function beginTurn(cx: Ctx, p: PlayerId): void {
  const s = cx.s;
  s.current = p;
  s.turnNumber += 1;
  s.turn = freshTurn(s);
  emit(cx, { t: "turn", p, n: s.turnNumber });
  const pl = s.players[p];
  const empty = s.rules.subSlots - pl.subs.length; // ターン開始時点の空き
  const n = s.rules.drawPerTurn + empty * s.rules.drawPerEmptySub;
  for (let i = 0; i < n; i++) drawOne(cx, p, true);
  if (s.rules.autoPlaceHandUnits) {
    for (const id of pl.hand.filter((x) => s.cards[x].kind === "unit")) {
      if (pl.subs.length >= s.rules.subSlots) break;
      pl.hand.splice(pl.hand.indexOf(id), 1);
      pl.subs.push(id);
      emit(cx, { t: "revive", p, id, toSub: true });
    }
  }
}

function runStep(cx: Ctx, step: Step): void {
  const s = cx.s;
  const p = s.current;
  switch (step) {
    case "auto": {
      if (s.turnNumber === 1 && !s.rules.firstTurnAutoDamage) return;
      const a = autoDamage(s, p).total;
      emit(cx, { t: "auto", p, amount: a });
      if (a > 0) dealDamage(cx, other(p), a);
      return;
    }
    case "needle": {
      for (const e of s.effects.filter((x) => x.kind === "needle" && x.on === p)) {
        if (s.phase === "over") return;
        dealDamage(cx, p, e.value, false);
      }
      return;
    }
    case "tenure": {
      const pl = s.players[p];
      const units = fieldUnits(s, p);
      for (const u of units) u.unit.tenure += 1;
      for (const u of units) {
        const zone = pl.main === u.id ? "main" : "sub";
        if (!u.unit.evolved && u.unit.tenure >= evoThreshold(s, u, zone)) evolve(cx, p, u);
      }
      for (const u of units) {
        const h = ATTRS[unitDef(u).attr].endTurnHeal;
        if (u.unit.evolved && h > 0) heal(cx, p, u.id, h);
      }
      return;
    }
    case "switch": {
      s.effects = s.effects.filter((e) => (e.on === p ? --e.turns > 0 : true));
      beginTurn(cx, other(p));
      return;
    }
  }
}

/** 中断していたターン終了処理を続ける（撃破後のメイン選択待ちで止まる） */
export function runResume(cx: Ctx): void {
  const s = cx.s;
  while (s.resume.length && s.pending.length === 0 && s.phase !== "over") {
    runStep(cx, s.resume.shift()!);
  }
}
