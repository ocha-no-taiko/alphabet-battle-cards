// トロフィーの条件の記録（track）のテスト。対戦の状態を直接作って、操作 1 回ぶんの記録を確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { addEffect, type Ctx } from "../engine/core.ts";
import { applyAction, createGame } from "../engine/game.ts";
import { unitCard } from "../engine/query.ts";
import type { Action, Card, DeckList, GameState, PlayerId } from "../engine/types.ts";
import { newRecord, track } from "./trophies.ts";

const DECK: DeckList = {
  units: ["A", "Z", "S", "H", "C", "M", "F"],
  symbols: ["+", "*", "%", "!", "()", "-", "|", ".", "$", "?", ";", "&", "^"],
};

function setup(): GameState {
  let s = createGame({ decks: [DECK, DECK], seed: 3, first: 0 });
  const unit = (p: PlayerId, l: string) => Object.values(s.cards).find((c) => c.owner === p && c.kind === "unit" && c.letter === l)!.id;
  s = applyAction(s, { type: "setup", player: 0, main: unit(0, "A"), subs: [] }).state;
  s = applyAction(s, { type: "setup", player: 1, main: unit(1, "Z"), subs: [unit(1, "S")] }).state;
  // 開始の 5 枚でサブに入ったユニットはデックへ戻す
  for (const p of [0, 1] as PlayerId[]) {
    const pl = s.players[p];
    const keep = p === 1 ? [unit(1, "S")] : [];
    pl.deck.push(...pl.subs.filter((id) => !keep.includes(id)));
    pl.subs = keep;
    pl.deck.push(...pl.hand.splice(0));
  }
  return s;
}

function find(s: GameState, p: PlayerId, pred: (c: Card) => boolean): number {
  return Object.values(s.cards).find((c) => c.owner === p && pred(c))!.id;
}

function take(s: GameState, id: number, zone: "hand" | "storage"): void {
  for (const pl of s.players) {
    for (const z of ["deck", "hand", "trash", "storage"] as const) {
      const i = pl[z].indexOf(id);
      if (i >= 0) pl[z].splice(i, 1);
    }
  }
  s.players[s.cards[id].owner][zone].push(id);
}

function run(s: GameState, a: Action, rec = newRecord()) {
  const r = applyAction(s, a);
  assert.ok(r.ok, r.ok ? "" : r.error);
  track(rec, s, a, r.events, 0, r.state);
  return { rec, s: r.state };
}

test("記号でトドメ: % で相手のメインを撃破すると symbolKO", () => {
  const s = setup();
  const pct = find(s, 0, (c) => c.kind === "sym" && c.sym === "%");
  take(s, pct, "hand");
  unitCard(s, s.players[1].main)!.unit.hp = 10;
  const { rec } = run(s, { type: "useSymbol", player: 0, card: pct });
  assert.equal(rec.symbolKO, true);
  assert.equal(rec.kos, 1);
});

test("Needle で撃破すると needleKO（記号やふつうのダメージでは立たない）", () => {
  let s = setup();
  const cx: Ctx = { s, events: [], trace: false };
  addEffect(cx, { kind: "needle", owner: 0, on: 1, turns: 1, value: 10 });
  s.rules.firstTurnAutoDamage = false;
  let rec = newRecord();
  ({ s, rec } = run(s, { type: "endTurn", player: 0 }, rec));
  // 相手のメインを Needle で倒せる HP にしておき、相手のターンを終える
  unitCard(s, s.players[1].main)!.unit.hp = 5;
  ({ rec } = run(s, { type: "endTurn", player: 1 }, rec));
  assert.equal(rec.needleKO, true);
  assert.equal(rec.symbolKO, false);
});

test("ストレートとゾロ目はストレージの並びで判定", () => {
  const s = setup();
  const ids = [3, 4, 5, 6].map((v) => find(s, 0, (c) => c.kind === "num" && c.value === v));
  for (const id of ids) take(s, id, "storage");
  const seven = find(s, 0, (c) => c.kind === "num" && c.value === 7);
  take(s, seven, "hand");
  const { rec } = run(s, { type: "placeNumber", player: 0, card: seven });
  assert.equal(rec.straight, true);

  const t = setup();
  const twos = Object.values(t.cards).filter((c) => c.owner === 0 && c.kind === "num" && c.value === 2).map((c) => c.id);
  take(t, twos[0], "storage");
  take(t, twos[1], "storage");
  take(t, twos[2], "hand");
  const r2 = run(t, { type: "placeNumber", player: 0, card: twos[2] });
  assert.equal(r2.rec.zorome, 3);
  assert.equal(r2.rec.straight, false);
});

test("一撃必殺: 満タンのメインを 1 回で倒す", () => {
  const s = setup();
  const target = unitCard(s, s.players[1].main)!;
  target.unit.hp = target.unit.maxHp = 15;
  const pct = find(s, 0, (c) => c.kind === "sym" && c.sym === "%");
  take(s, pct, "hand");
  const { rec } = run(s, { type: "useSymbol", player: 0, card: pct });
  assert.equal(rec.oneShot, true);
});
