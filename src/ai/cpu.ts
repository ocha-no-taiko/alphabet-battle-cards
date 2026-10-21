// 簡易 CPU。合法手を 1 手ずつ試して、評価値がいちばん上がる手を選ぶ（1 手読みの貪欲法）。
// 相手のハンドの中身は評価に使わない。
import { applyAction, requestsForSkill, requestsForSymbol } from "../engine/game.ts";
import {
  autoDamage, autoPay, canPlace, canUseSkill, canUseSymbol, fieldUnits, mainCandidates, other, skillCost, sumEffect,
  activeEffects, numberLeft, unitAtk, unitCard,
} from "../engine/query.ts";
import { rand } from "../engine/rng.ts";
import type { Action, Card, ChoiceRequest, Choices, GameState, PlayerId } from "../engine/types.ts";
import aiConfig from "../data/ai.json" with { type: "json" };

export type CpuLevel = "normal" | "passive";

export interface Cpu {
  level: CpuLevel;
  rng: { rng: number };
}

export function makeCpu(level: CpuLevel, seed: number): Cpu {
  return { level, rng: { rng: seed >>> 0 } };
}

const W = aiConfig.weights;

function sig(c: Card): string {
  if (c.kind === "num") return `n${c.value}`;
  if (c.kind === "sym") return `s${c.sym}`;
  return `u${c.letter}${c.unit.evolved ? "!" : ""}${c.unit.hp}`;
}

/** 状態の評価値（me から見て大きいほど良い） */
export function evaluate(s: GameState, me: PlayerId): number {
  if (s.phase === "over") return s.winner === me ? 1e6 : -1e6;
  const opp = other(me);
  const P = s.players;
  let v = W.ko * (P[me].kos - P[opp].kos);
  const myMain = unitCard(s, P[me].main);
  const oppMain = unitCard(s, P[opp].main);
  v += myMain ? myMain.unit.hp * W.myHp : -W.mainMissing;
  v -= oppMain ? oppMain.unit.hp * W.oppHp : -W.mainMissing;
  const side = (p: PlayerId) => {
    let x = 0;
    for (const u of fieldUnits(s, p)) {
      x += W.unitOnField + unitAtk(s, u) * W.atk + (u.unit.evolved ? W.evolved : u.unit.tenure * W.tenure);
      if (u.id !== P[p].main) x += u.unit.hp * W.subHp;
    }
    for (const id of P[p].storage) {
      const c = s.cards[id];
      if (c.kind === "num") x += W.storageCard + numberLeft(c) * W.storageValue + (c.value === 0 ? W.storageZero : 0);
    }
    return x;
  };
  v += side(me) - side(opp);
  for (const id of P[me].hand) v += W.hand[s.cards[id].kind];
  v -= P[opp].hand.length * W.oppHand;
  // 自分のターン中なら、このあとの自動ダメージを見込む
  if (s.current === me && s.phase === "main" && oppMain) {
    const raw = autoDamage(s, me).total;
    let d = Math.max(0, raw - sumEffect(s, "guard", opp));
    if (activeEffects(s, "half", opp).length) d = Math.ceil(d / 2);
    v += Math.min(d, oppMain.unit.hp) * W.autoDamage;
    if (d >= oppMain.unit.hp) v += W.autoKo;
  }
  for (const e of s.effects) {
    const sign = e.owner === me ? 1 : -1;
    const w = (W.effects as Record<string, number>)[e.kind] ?? 0;
    const amount = e.kind.startsWith("seal") ? e.turns : e.value;
    v += sign * w * amount;
  }
  if (s.current === me) v += s.turn.costReduce * W.costReduce;
  return v;
}

function pickCombos(s: GameState, req: ChoiceRequest, cpu: Cpu): number[][] {
  if (req.count === 0) return [[]];
  const seen = new Set<string>();
  const uniq = req.options.filter((id) => {
    const k = sig(s.cards[id]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (req.count === 1) return uniq.map((id) => [id]);
  // 2 枚以上: 値の大きい順とランダムをいくつか
  const score = (id: number) => {
    const c = s.cards[id];
    return c.kind === "num" ? c.value + (c.value === 0 ? 8 : 0) : c.kind === "unit" ? unitAtk(s, c) : 5;
  };
  const sorted = [...req.options].sort((a, b) => score(b) - score(a));
  const out = [sorted.slice(0, req.count)];
  for (let i = 0; i < 2; i++) {
    const pool = [...req.options];
    const pick: number[] = [];
    while (pick.length < req.count) pick.push(pool.splice(Math.floor(rand(cpu.rng) * pool.length), 1)[0]);
    out.push(pick);
  }
  return out;
}

function choiceCombos(s: GameState, reqs: ChoiceRequest[], cpu: Cpu): Choices[] {
  let combos: Choices[] = [{}];
  for (const r of reqs) {
    const next: Choices[] = [];
    for (const base of combos) for (const pick of pickCombos(s, r, cpu)) next.push({ ...base, [r.key]: pick });
    combos = next.slice(0, 16);
  }
  return combos;
}

export function candidateActions(s: GameState, p: PlayerId, cpu: Cpu): Action[] {
  const out: Action[] = [];
  const pl = s.players[p];
  const seen = new Set<string>();
  for (const id of pl.hand) {
    const c = s.cards[id];
    const k = sig(c);
    if (seen.has(k)) continue;
    seen.add(k);
    if (c.kind === "num" && !canPlace(s, p, id)) out.push({ type: "placeNumber", player: p, card: id });
    if (c.kind === "sym" && !canUseSymbol(s, p, id)) {
      for (const choices of choiceCombos(s, requestsForSymbol(s, p, id), cpu))
        out.push({ type: "useSymbol", player: p, card: id, choices });
    }
  }
  for (const u of fieldUnits(s, p)) {
    if (canUseSkill(s, p, u.id)) continue;
    const payment = autoPay(s, p, skillCost(s, p, u.id));
    if (!payment) continue;
    for (const choices of choiceCombos(s, requestsForSkill(s, p, u.id, payment), cpu))
      out.push({ type: "useSkill", player: p, unit: u.id, payment, choices });
  }
  return out;
}

function setupAction(s: GameState, p: PlayerId, cpu: Cpu): Action {
  const units = s.players[p].pool.map((id) => unitCard(s, id)!);
  const byHp = [...units].sort((a, b) => b.unit.maxHp - a.unit.maxHp || rand(cpu.rng) - 0.5);
  const main = byHp[0];
  const rest = units.filter((u) => u !== main).sort((a, b) => unitAtk(s, b) - unitAtk(s, a) || rand(cpu.rng) - 0.5);
  const n = aiConfig.setupSubs[Math.floor(rand(cpu.rng) * aiConfig.setupSubs.length)];
  return { type: "setup", player: p, main: main.id, subs: rest.slice(0, n).map((u) => u.id) };
}

/** p の次の操作を返す */
export function cpuAction(s: GameState, p: PlayerId, cpu: Cpu): Action {
  if (s.phase === "setup") return setupAction(s, p, cpu);
  if (s.pending.length && s.pending[0].player === p) {
    let best = mainCandidates(s, p)[0];
    let bestV = -Infinity;
    for (const id of mainCandidates(s, p)) {
      const r = applyAction(s, { type: "chooseMain", player: p, card: id });
      const v = r.ok ? evaluate(r.state, p) : -Infinity;
      if (v > bestV) [best, bestV] = [id, v];
    }
    return { type: "chooseMain", player: p, card: best };
  }
  const end: Action = { type: "endTurn", player: p };
  if (cpu.level === "passive") {
    const num = s.players[p].hand.find((id) => s.cards[id].kind === "num" && !canPlace(s, p, id));
    return num !== undefined ? { type: "placeNumber", player: p, card: num } : end;
  }
  const base = evaluate(s, p);
  let best: Action = end;
  let bestV = base + aiConfig.minGain;
  for (const a of candidateActions(s, p, cpu)) {
    const r = applyAction(s, a);
    if (!r.ok) continue;
    const v = evaluate(r.state, p) + rand(cpu.rng) * aiConfig.noise;
    if (v > bestV) [best, bestV] = [a, v];
  }
  return best;
}
