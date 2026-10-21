// 仕様書 14.2 の受け入れテストと、効果の部品のテスト。
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, createGame } from "./game.ts";
import { addEffect, dealDamage, type Ctx } from "./core.ts";
import { autoDamage, isValidPayment, locate, unitCard } from "./query.ts";
import type { Action, Card, DeckList, GameState, PlayerId } from "./types.ts";
import { playGame } from "../sim/play.ts";

const DECK: DeckList = {
  units: ["A", "Z", "S", "H", "C", "M", "F"],
  symbols: ["+", "*", "%", "!", "()", "-", "|", ".", "$", "?", ";", "&", "^"],
};

function act(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  assert.ok(r.ok, r.ok ? "" : `action failed: ${r.error}`);
  return r.state;
}

function find(s: GameState, p: PlayerId, pred: (c: Card) => boolean): number {
  const c = Object.values(s.cards).find((x) => x.owner === p && pred(x));
  assert.ok(c, "card not found");
  return c.id;
}
const num = (s: GameState, p: PlayerId, v: number, skip: number[] = []) =>
  find(s, p, (c) => c.kind === "num" && c.value === v && !skip.includes(c.id));
const sym = (s: GameState, p: PlayerId, k: string) => find(s, p, (c) => c.kind === "sym" && c.sym === k);
const unit = (s: GameState, p: PlayerId, l: string) => find(s, p, (c) => c.kind === "unit" && c.letter === l);

/** カードを今の場所から抜いて、指定の場所に置く */
function move(s: GameState, id: number, zone: "hand" | "storage" | "trash" | "deckTop" | "sub" | "main"): void {
  const loc = locate(s, id);
  const owner = s.cards[id].owner;
  if (loc) {
    const pl = s.players[loc.p];
    if (loc.zone === "main") pl.main = null;
    else if (loc.zone === "sub") pl.subs.splice(loc.index, 1);
    else if (loc.zone !== "resolving") pl[loc.zone].splice(loc.index, 1);
  }
  const pl = s.players[owner];
  if (zone === "main") pl.main = id;
  else if (zone === "sub") pl.subs.push(id);
  else if (zone === "deckTop") pl.deck.unshift(id);
  else pl[zone].push(id);
}

/** 準備済みのゲーム。P0 のメイン A・P1 のメイン Z、サブは指定。先攻 P0 */
function setupGame(opts: { subs0?: string[]; subs1?: string[]; rules?: object } = {}): GameState {
  let s = createGame({ decks: [DECK, DECK], seed: 42, first: 0, rules: opts.rules });
  const ids = (p: PlayerId, ls: string[]) => ls.map((l) => unit(s, p, l));
  s = act(s, { type: "setup", player: 0, main: unit(s, 0, "A"), subs: ids(0, opts.subs0 ?? []) });
  s = act(s, { type: "setup", player: 1, main: unit(s, 1, "Z"), subs: ids(1, opts.subs1 ?? []) });
  // 開始の 5 枚でサブに入ったユニットはデックに戻し、サブを指定どおりにする
  for (const p of [0, 1] as PlayerId[]) {
    const want = ids(p, (p === 0 ? opts.subs0 : opts.subs1) ?? []);
    const pl = s.players[p];
    pl.deck.push(...pl.subs.filter((id) => !want.includes(id)));
    pl.subs = want;
  }
  return s;
}

/** 手札・サブを空にして、決まった状態から始めたいとき用 */
function clearHands(s: GameState): void {
  for (const p of [0, 1] as PlayerId[]) {
    const pl = s.players[p];
    pl.deck.push(...pl.hand.splice(0));
  }
}

test("お釣りなし: [9] でコスト3を払うと 9 がトラッシュへ。[0] ならコスト6も払える", () => {
  let s = setupGame();
  clearHands(s);
  s.players[0].storage = [];
  const nine = num(s, 0, 9);
  move(s, nine, "storage");
  const a = unit(s, 0, "A");
  assert.equal(isValidPayment(s, 0, [nine], 3), true);
  const hp = unitCard(s, s.players[1].main)!.unit.hp;
  s = act(s, { type: "useSkill", player: 0, unit: a, payment: [nine] });
  assert.deepEqual(s.players[0].storage, []);
  assert.ok(s.players[0].trash.includes(nine));
  assert.equal(unitCard(s, s.players[1].main)!.unit.hp, hp - 10);

  // 0 はコスト 6 でも 1 枚で払える
  let t = setupGame();
  clearHands(t);
  const zero = num(t, 0, 0);
  move(t, zero, "storage");
  const z = unit(t, 0, "Z");
  move(t, z, "sub");
  t = act(t, { type: "useSkill", player: 0, unit: z, payment: [zero] });
  assert.equal(unitCard(t, t.players[1].main)!.unit.hp, 60 - 25);
});

test("支払い: 余分な札を含む支払いは拒否", () => {
  const s = setupGame();
  clearHands(s);
  const nine = num(s, 0, 9);
  const three = num(s, 0, 3);
  move(s, nine, "storage");
  move(s, three, "storage");
  assert.equal(isValidPayment(s, 0, [nine, three], 3), false);
  assert.equal(isValidPayment(s, 0, [three], 3), true);
  const r = applyAction(s, { type: "useSkill", player: 0, unit: unit(s, 0, "A"), payment: [nine, three] });
  assert.equal(r.ok, false);
});

test("追加ドロー: サブ 2 枚（空き 1）なら 2 枚引く。1 枚目のユニットがサブに入っても 2 枚目を引く", () => {
  let s = setupGame({ subs1: ["S", "H"] });
  const p1 = s.players[1];
  const handBefore = p1.hand.length;
  const deckBefore = p1.deck.length;
  // P1 のデックの上を「ユニット・数字」にする
  const u = p1.deck.find((id) => s.cards[id].kind === "unit")!;
  const n = p1.deck.find((id) => s.cards[id].kind === "num")!;
  move(s, n, "deckTop");
  move(s, u, "deckTop");
  s = act(s, { type: "endTurn", player: 0 });
  assert.equal(s.current, 1);
  assert.equal(s.players[1].subs.length, 3);
  assert.ok(s.players[1].subs.includes(u));
  assert.equal(s.players[1].hand.length, handBefore + 1);
  assert.ok(s.players[1].hand.includes(n));
  assert.equal(s.players[1].deck.length, deckBefore - 2);
});

test("進化: メインは 3 回目、サブは 4 回目の自分のターン終了時", () => {
  let s = setupGame({ subs0: ["S"], rules: { firstTurnAutoDamage: false } });
  // ダメージで倒れないように HP を大きくしておく
  for (const c of Object.values(s.cards)) if (c.kind === "unit") c.unit.hp = c.unit.maxHp = 999;
  const a = unit(s, 0, "A");
  const sub = unit(s, 0, "S");
  const endBoth = () => {
    s = act(s, { type: "endTurn", player: 0 });
    s = act(s, { type: "endTurn", player: 1 });
  };
  endBoth();
  endBoth();
  assert.equal(unitCard(s, a)!.unit.evolved, false);
  s = act(s, { type: "endTurn", player: 0 }); // 3 回目
  assert.equal(unitCard(s, a)!.unit.evolved, true);
  assert.equal(unitCard(s, a)!.unit.maxHp, 999 + 5); // Diagonal は HP +5 のみ
  assert.equal(unitCard(s, sub)!.unit.evolved, false);
  s = act(s, { type: "endTurn", player: 1 });
  s = act(s, { type: "endTurn", player: 0 }); // 4 回目
  assert.equal(unitCard(s, sub)!.unit.evolved, true);
});

test("通算: サブで 3 ターン過ごしたユニットがメインに上がると、そのターン終了時に進化", () => {
  let s = setupGame({ subs0: ["S"] });
  const sub = unit(s, 0, "S");
  const a = unit(s, 0, "A");
  unitCard(s, sub)!.unit.tenure = 3;
  s.players[0].subs = [a];
  s.players[0].main = sub;
  s = act(s, { type: "endTurn", player: 0 });
  assert.equal(unitCard(s, sub)!.unit.evolved, true);
});

test("撃破と勝敗: 撃破数 5 で終了。メインが倒れてサブにもハンドにもユニットがいなければ負け", () => {
  let s = setupGame();
  clearHands(s);
  s.players[0].kos = 4;
  unitCard(s, s.players[1].main)!.unit.hp = 5;
  const nine = num(s, 0, 9);
  move(s, nine, "storage");
  s = act(s, { type: "useSkill", player: 0, unit: unit(s, 0, "A"), payment: [nine] });
  assert.equal(s.phase, "over");
  assert.equal(s.winner, 0);
  assert.equal(s.endReason, "kos");

  let t = setupGame();
  clearHands(t);
  unitCard(t, t.players[1].main)!.unit.hp = 5;
  const n9 = num(t, 0, 9);
  move(t, n9, "storage");
  t = act(t, { type: "useSkill", player: 0, unit: unit(t, 0, "A"), payment: [n9] });
  assert.equal(t.phase, "over");
  assert.equal(t.endReason, "noUnits");
});

test("撃破後はサブかハンドのユニットから新しいメインを選び、ターン終了処理の続きに戻る", () => {
  let s = setupGame({ subs1: ["S"] });
  clearHands(s);
  unitCard(s, s.players[1].main)!.unit.hp = 1;
  s = act(s, { type: "endTurn", player: 0 }); // 自動ダメージで撃破 → 選択待ち
  assert.equal(s.pending[0]?.player, 1);
  assert.equal(s.current, 0);
  const sub = unit(s, 1, "S");
  s = act(s, { type: "chooseMain", player: 1, card: sub });
  assert.equal(s.players[1].main, sub);
  assert.equal(s.current, 1); // 続きでターンが移った
  assert.equal(s.players[0].kos, 1);
});

test("デック切れ: トラッシュを戻してシャッフルして引く", () => {
  let s = setupGame();
  const p1 = s.players[1];
  p1.trash.push(...p1.deck.splice(0));
  const trashN = p1.trash.length;
  s = act(s, { type: "endTurn", player: 0 });
  const after = s.players[1];
  assert.equal(after.trash.length, 0);
  assert.equal(after.deck.length + after.hand.length + after.subs.length - p1.hand.length - p1.subs.length, trashN);
});

test("ガード: ガード10 で 25 ダメージは 15。半分が重なると減算が先（(25-10)/2 → 8）", () => {
  const s = setupGame();
  const cx: Ctx = { s, events: [], trace: false };
  s.current = 0; // P1 のメインを P0 が攻撃する場面
  const z = unitCard(s, s.players[1].main)!;
  addEffect(cx, { kind: "guard", owner: 1, on: 0, turns: 1, value: 10 });
  assert.equal(dealDamage(cx, 1, 25), 15);
  assert.equal(z.unit.hp, 60 - 15);
  addEffect(cx, { kind: "half", owner: 1, on: 0, turns: 1, value: 1 });
  assert.equal(dealDamage(cx, 1, 25), 8);
});

test("記号の上限: 2 枚目は拒否。; を使ったあとはあと 1 枚使える", () => {
  let s = setupGame();
  clearHands(s);
  for (const k of ["+", "*", ";", "%"]) move(s, sym(s, 0, k), "hand");
  s = act(s, { type: "useSymbol", player: 0, card: sym(s, 0, "+") });
  const r = applyAction(s, { type: "useSymbol", player: 0, card: sym(s, 0, "*") });
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.error, "symbolLimit");
  s = act(s, { type: "useSymbol", player: 0, card: sym(s, 0, ";") });
  s = act(s, { type: "useSymbol", player: 0, card: sym(s, 0, "*") });
  assert.equal(applyAction(s, { type: "useSymbol", player: 0, card: sym(s, 0, "%") }).ok, false);
});

test("自動ダメージ: メインATK + サブATK合計 × 倍率（切り上げ）。+ と * が乗る", () => {
  let s = setupGame({ subs0: ["S", "H"] }); // A 8 + (8 + 8) × 0.5 = 16
  assert.equal(autoDamage(s, 0).total, 16);
  clearHands(s);
  move(s, sym(s, 0, "*"), "hand");
  s = act(s, { type: "useSymbol", player: 0, card: sym(s, 0, "*") });
  assert.equal(autoDamage(s, 0).total, 24);
  s.players[0].subs.push(unit(s, 0, "M")); // サブ合計 26 × 0.5 = 13（切り上げで端数なし）
  s.turn.subMult = null;
  s.rules.subMultiplier = 0.5;
  assert.equal(autoDamage(s, 0).total, 8 + 13);
});

test("封じ: | を受けた側は次のターンに記号を使えない。. で解除できる", () => {
  let s = setupGame();
  clearHands(s);
  move(s, sym(s, 0, "|"), "hand");
  move(s, sym(s, 1, "%"), "hand");
  move(s, sym(s, 1, "."), "hand");
  s = act(s, { type: "useSymbol", player: 0, card: sym(s, 0, "|") });
  s = act(s, { type: "endTurn", player: 0 });
  const r = applyAction(s, { type: "useSymbol", player: 1, card: sym(s, 1, "%") });
  assert.equal(r.ok ? "" : r.error, "sealSymbol");
  // . も記号なので封じ中は使えない（仕様どおり）
  assert.equal(applyAction(s, { type: "useSymbol", player: 1, card: sym(s, 1, ".") }).ok, false);
  s = act(s, { type: "endTurn", player: 1 });
  s = act(s, { type: "endTurn", player: 0 });
  // 1 ターンで切れる
  assert.equal(applyAction(s, { type: "useSymbol", player: 1, card: sym(s, 1, "%") }).ok, true);
});

test("Needle: 次の相手ターンの終了時にダメージ", () => {
  let s = setupGame({ rules: { firstTurnAutoDamage: false } });
  clearHands(s);
  const n = unit(s, 0, "M"); // Needle は持っていないので効果を直接置く
  void n;
  const cx: Ctx = { s, events: [], trace: false };
  addEffect(cx, { kind: "needle", owner: 0, on: 1, turns: 1, value: 10 });
  s = act(s, { type: "endTurn", player: 0 });
  const hp = unitCard(s, s.players[1].main)!.unit.hp;
  s = act(s, { type: "endTurn", player: 1 });
  assert.ok(unitCard(s, s.players[1].main)!.unit.hp <= hp - 10);
  assert.equal(s.effects.filter((e) => e.kind === "needle").length, 0);
});

test("再現性: 同じ seed なら同じ結果", () => {
  const a = playGame([DECK, DECK], 7);
  const b = playGame([DECK, DECK], 7);
  assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
  assert.equal(a.state.phase, "over");
});

test("CPU 同士の対戦が最後まで進む（いろいろな seed とデック）", async () => {
  const { DECK_PRESETS } = await import("./data.ts");
  for (let i = 0; i < 12; i++) {
    const a = DECK_PRESETS[i % DECK_PRESETS.length];
    const b = DECK_PRESETS[(i * 3 + 1) % DECK_PRESETS.length];
    const r = playGame([a, b], 100 + i);
    assert.equal(r.state.phase, "over", `seed ${100 + i} did not finish`);
    // カードが増えたり消えたりしていない
    for (const p of [0, 1] as PlayerId[]) {
      const pl = r.state.players[p];
      const total = pl.deck.length + pl.hand.length + pl.trash.length + pl.storage.length + pl.subs.length + (pl.main === null ? 0 : 1);
      assert.equal(total, 50);
    }
  }
});
