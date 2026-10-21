// 効果の部品。技と記号の ops（units.json / symbols.json）をここで解決する。
// 選択が要る部品は choiceRequests で「どこから何枚」を返し、プレイヤーの選択は Choices（キー = 部品の番号）で受け取る。
import type { Op } from "./data.ts";
import { addEffect, dealDamage, drawOne, emit, heal, returnUnitToHand, toTrash, type Ctx } from "./core.ts";
import { card, freshUnitState, isActive, other, unitCard } from "./query.ts";
import { randInt, shuffle } from "./rng.ts";
import type { ChoiceRequest, Choices, GameState, PlayerId } from "./types.ts";

const num = (op: Op, k: string, d = 0) => (typeof op[k] === "number" ? (op[k] as number) : d);
const str = (op: Op, k: string) => String(op[k] ?? "");

function kindIs(s: GameState, id: number, kind: string): boolean {
  return s.cards[id].kind === kind;
}

function storageProtected(s: GameState, owner: PlayerId): boolean {
  return s.effects.some((e) => e.kind === "protectStorage" && e.owner === owner && isActive(s, e));
}

/** 効果に必要な選択の一覧。p は効果を使うプレイヤー。状態は支払い・記号の移動を済ませたあとのもの */
export function choiceRequests(s: GameState, p: PlayerId, ops: Op[]): ChoiceRequest[] {
  const me = s.players[p];
  const opp = s.players[other(p)];
  const reqs: ChoiceRequest[] = [];
  const add = (key: string, op: string, src: ChoiceRequest["src"], options: number[], want: number) => {
    reqs.push({ key, op, src, options, count: Math.min(want, options.length) });
  };
  ops.forEach((op, i) => {
    const k = String(i);
    switch (op.op) {
      case "search":
        add(k, op.op, "deck", me.deck.filter((id) => kindIs(s, id, str(op, "kind"))), num(op, "count", 1));
        break;
      case "kick":
        if (!storageProtected(s, other(p))) add(k, op.op, "oppStorage", [...opp.storage], num(op, "count", 1));
        break;
      case "peekDiscard":
        add(k, op.op, "oppHand", [...opp.hand], num(op, "count", 1));
        break;
      case "warp":
        if (opp.main !== null) add(k, op.op, "oppSub", [...opp.subs], 1);
        break;
      case "swapSub":
        if (me.main !== null) add(k, op.op, "ownSub", [...me.subs], 1);
        break;
      case "recover":
        add(k, op.op, "ownTrash", me.trash.filter((id) => kindIs(s, id, str(op, "kind"))), num(op, "count", 1));
        break;
      case "revive":
        add(k, op.op, "ownTrash", me.trash.filter((id) => kindIs(s, id, "unit")), 1);
        break;
      case "storageToHand":
        add(k, op.op, "ownStorage", [...me.storage], num(op, "count", 1));
        break;
      case "boostStorage":
        add(k, op.op, "ownStorage", me.storage.filter((id) => (s.cards[id] as { value?: number }).value !== 0), 1);
        break;
      case "cycle":
        add(k, op.op, "ownHand", [...me.hand], 1);
        break;
      case "swapHandSub": {
        const handUnits = me.hand.filter((id) => kindIs(s, id, "unit"));
        const both = handUnits.length > 0 && me.subs.length > 0;
        add(`${k}h`, op.op, "ownHand", both ? handUnits : [], 1);
        add(`${k}s`, op.op, "ownSub", both ? [...me.subs] : [], 1);
        break;
      }
    }
  });
  return reqs;
}

export function validateChoices(reqs: ChoiceRequest[], choices: Choices | undefined): boolean {
  for (const r of reqs) {
    const picks = choices?.[r.key] ?? [];
    if (picks.length !== r.count || new Set(picks).size !== picks.length) return false;
    if (!picks.every((id) => r.options.includes(id))) return false;
  }
  return true;
}

function remove(arr: number[], id: number): void {
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
}

/** 効果を順に解決する */
export function resolveOps(cx: Ctx, p: PlayerId, ops: Op[], choices: Choices): void {
  const s = cx.s;
  const q = other(p);
  const me = s.players[p];
  const opp = s.players[q];
  ops.forEach((op, i) => {
    if (s.phase === "over") return;
    const pick = choices[String(i)] ?? [];
    switch (op.op) {
      case "damage":
        dealDamage(cx, q, num(op, "amount"));
        break;
      case "heal":
        heal(cx, p, me.main, num(op, "amount"));
        break;
      case "guard":
        addEffect(cx, { kind: "guard", owner: p, on: q, turns: 1, value: num(op, "amount") });
        break;
      case "halfDamage":
        addEffect(cx, { kind: "half", owner: p, on: q, turns: 1, value: 1 });
        break;
      case "reflect":
        addEffect(cx, { kind: "reflect", owner: p, on: q, turns: 1, value: num(op, "ratio", 0.5) });
        break;
      case "protectStorage":
        addEffect(cx, { kind: "protectStorage", owner: p, on: q, turns: 1, value: 1 });
        break;
      case "seal": {
        const what = str(op, "what");
        const kind = what === "symbol" ? "sealSymbol" : what === "storage" ? "sealStorage" : "sealMainSkill";
        addEffect(cx, { kind, owner: p, on: q, turns: num(op, "turns", 1), value: 1 });
        break;
      }
      case "needle":
        addEffect(cx, { kind: "needle", owner: p, on: q, turns: 1, value: num(op, "amount") });
        break;
      case "costUp":
        addEffect(cx, { kind: "costUp", owner: p, on: q, turns: 1, value: num(op, "amount") });
        break;
      case "autoMinus":
        addEffect(cx, { kind: "autoMinus", owner: p, on: q, turns: 1, value: num(op, "amount") });
        break;
      case "oppSubMult":
        addEffect(cx, { kind: "subMultSet", owner: p, on: q, turns: 1, value: num(op, "value") });
        break;
      case "storageCap":
        // 次の自分のターン終了時まで（このターンの終了で 1、次のターンの終了で 0）
        addEffect(cx, { kind: "storageCap", owner: p, on: p, turns: 2, value: num(op, "amount", 1) });
        break;
      case "autoBonus":
        s.turn.autoBonus += num(op, "amount");
        emit(cx, { t: "effect", p, kind: "autoBonus", value: num(op, "amount") });
        break;
      case "subMult":
        s.turn.subMult = num(op, "value", 1);
        emit(cx, { t: "effect", p, kind: "subMult", value: s.turn.subMult });
        break;
      case "extraSkill":
        s.turn.skillsAllowed += num(op, "count", 1);
        emit(cx, { t: "effect", p, kind: "extraSkill", value: num(op, "count", 1) });
        break;
      case "extraSymbol":
        s.turn.symbolsAllowed += num(op, "count", 1);
        emit(cx, { t: "effect", p, kind: "extraSymbol", value: num(op, "count", 1) });
        break;
      case "extraStorage":
        s.turn.numbersAllowed += num(op, "count", 1);
        emit(cx, { t: "effect", p, kind: "extraStorage", value: num(op, "count", 1) });
        break;
      case "costReduce":
        s.turn.costReduce += num(op, "amount");
        emit(cx, { t: "effect", p, kind: "costReduce", value: num(op, "amount") });
        break;
      case "boostStorage":
        if (pick.length) {
          s.turn.boostCard = pick[0];
          s.turn.boostAmount = num(op, "amount", 2);
          emit(cx, { t: "effect", p, kind: "boost", value: s.turn.boostAmount });
        }
        break;
      case "evoShift": {
        const target = str(op, "target") === "selfMain" ? me.main : opp.main;
        const u = unitCard(s, target);
        if (u && !u.unit.evolved) {
          u.unit.evoShift += num(op, "amount");
          emit(cx, { t: "effect", p, kind: "evoShift", value: num(op, "amount") });
        }
        break;
      }
      case "draw":
        for (let n = 0; n < num(op, "count", 1); n++) drawOne(cx, p, false);
        break;
      case "search":
        if (pick.length) {
          for (const id of pick) remove(me.deck, id);
          me.hand.push(...pick);
          emit(cx, { t: "toHand", p, ids: pick, from: "deck" });
        }
        shuffle(s, me.deck);
        break;
      case "recover":
        if (pick.length) {
          for (const id of pick) remove(me.trash, id);
          me.hand.push(...pick);
          emit(cx, { t: "toHand", p, ids: pick, from: "trash" });
        }
        break;
      case "storageToHand":
        if (pick.length) {
          for (const id of pick) remove(me.storage, id);
          me.hand.push(...pick);
          emit(cx, { t: "toHand", p, ids: pick, from: "storage" });
        }
        break;
      case "kick":
        if (s.effects.some((e) => e.kind === "protectStorage" && e.owner === q && isActive(s, e))) {
          emit(cx, { t: "blocked", p: q });
        } else if (pick.length) {
          for (const id of pick) {
            remove(opp.storage, id);
            toTrash(s, q, id);
          }
          emit(cx, { t: "trashed", p: q, ids: pick, from: "storage" });
        }
        break;
      case "yank": {
        const ids: number[] = [];
        for (let n = 0; n < num(op, "count", 1) && opp.hand.length; n++) {
          const id = opp.hand[randInt(s, opp.hand.length)];
          remove(opp.hand, id);
          toTrash(s, q, id);
          ids.push(id);
        }
        if (ids.length) emit(cx, { t: "trashed", p: q, ids, from: "hand" });
        break;
      }
      case "peekDiscard":
        if (pick.length) {
          for (const id of pick) {
            remove(opp.hand, id);
            toTrash(s, q, id);
          }
          emit(cx, { t: "trashed", p: q, ids: pick, from: "hand" });
        }
        break;
      case "cycle":
        if (pick.length) {
          remove(me.hand, pick[0]);
          toTrash(s, p, pick[0]);
          emit(cx, { t: "trashed", p, ids: pick, from: "hand" });
        }
        drawOne(cx, p, false);
        break;
      case "reshuffleHand": {
        const n = me.hand.length;
        me.deck.push(...me.hand.splice(0));
        shuffle(s, me.deck);
        emit(cx, { t: "reshuffle", p, count: n });
        for (let k = 0; k < n; k++) drawOne(cx, p, false);
        break;
      }
      case "warp":
        if (pick.length && opp.main !== null) {
          const sub = pick[0];
          const old = opp.main;
          opp.subs[opp.subs.indexOf(sub)] = old;
          opp.main = sub;
          emit(cx, { t: "swap", p: q, a: old, b: sub });
          if (num(op, "damage") > 0) dealDamage(cx, q, num(op, "damage"));
        }
        break;
      case "swapSub":
        if (pick.length && me.main !== null) {
          const sub = pick[0];
          const old = me.main;
          me.subs[me.subs.indexOf(sub)] = old;
          me.main = sub;
          emit(cx, { t: "swap", p, a: old, b: sub });
          if (num(op, "heal") > 0) heal(cx, p, me.main, num(op, "heal"));
        }
        break;
      case "swapHandSub": {
        const h = choices[`${i}h`]?.[0];
        const sub = choices[`${i}s`]?.[0];
        if (h !== undefined && sub !== undefined) {
          remove(me.hand, h);
          me.subs[me.subs.indexOf(sub)] = h;
          const out = unitCard(s, sub)!;
          returnUnitToHand(s, out);
          const inn = unitCard(s, h)!;
          inn.unit.tenure = 0;
          me.hand.push(sub);
          emit(cx, { t: "swap", p, a: sub, b: h });
        }
        break;
      }
      case "swapHp": {
        const a = unitCard(s, me.main);
        const b = unitCard(s, opp.main);
        if (a && b) {
          const ha = a.unit.hp;
          a.unit.hp = Math.min(a.unit.maxHp, b.unit.hp);
          b.unit.hp = Math.min(b.unit.maxHp, ha);
          emit(cx, { t: "swapHp", p });
        }
        break;
      }
      case "gamble": {
        const id = drawOne(cx, p, false);
        const c = id === null ? null : card(s, id);
        if (c && c.kind === "num" && c.value > 0) dealDamage(cx, q, c.value * num(op, "mult", 1));
        break;
      }
      case "revive":
        if (pick.length) {
          const u = unitCard(s, pick[0])!;
          remove(me.trash, u.id);
          u.unit = freshUnitState(u.letter);
          if (str(op, "hp") === "half") u.unit.hp = Math.ceil(u.unit.maxHp / 2);
          const toSub = me.subs.length < s.rules.subSlots;
          if (toSub) me.subs.push(u.id);
          else me.hand.push(u.id);
          emit(cx, { t: "revive", p, id: u.id, toSub });
        }
        break;
      case "cleanse": {
        const kinds = s.rules.cleanseKinds as string[];
        const before = s.effects.length;
        s.effects = s.effects.filter((e) => !(e.on === p && e.owner === q && kinds.includes(e.kind)));
        emit(cx, { t: "effect", p, kind: "cleanse", value: before - s.effects.length });
        break;
      }
      default:
        throw new Error(`unknown op ${op.op}`);
    }
  });
}
