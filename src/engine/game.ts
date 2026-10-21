// ゲームの作成と操作の適用。applyAction は入力の状態を変えず、新しい状態とイベントを返す。
import { DECK_RULES, SYMBOLS, mergeRules, type Rules } from "./data.ts";
import { beginTurn, drawOne, emit, freshTurn, payCost, runResume, type Ctx } from "./core.ts";
import { choiceRequests, resolveOps, validateChoices } from "./effects.ts";
import {
  canEndTurn, canPlace, canUseSkill, canUseSymbol, card, freshUnitState, isValidPayment, mainCandidates, skillCost,
  skillForm, unitCard,
} from "./query.ts";
import { randInt, shuffle } from "./rng.ts";
import type { Action, ActionResult, Card, ChoiceRequest, DeckList, GameState, PlayerId, PlayerState } from "./types.ts";

export interface CreateOptions {
  decks: [DeckList, DeckList];
  seed: number;
  rules?: Partial<Rules>;
  /**
   * デックの上に積む順番（チュートリアル用）。数字は "3"、記号は ID、ユニットは文字。
   * 開始のシャッフルのあと、ここに書いたカードをこの順でいちばん上に置く。
   */
  stack?: [string[]?, string[]?];
  /** 先攻を固定する（rules.firstPlayer より優先） */
  first?: PlayerId;
}

function emptyPlayer(): PlayerState {
  return { deck: [], hand: [], trash: [], storage: [], main: null, subs: [], kos: 0, pool: [], setup: null, resolving: null };
}

export function createGame(opts: CreateOptions): GameState {
  const rules = mergeRules(opts.rules);
  const s: GameState = {
    seed: opts.seed,
    rng: opts.seed >>> 0,
    phase: "setup",
    turnNumber: 0,
    current: 0,
    first: 0,
    players: [emptyPlayer(), emptyPlayer()],
    cards: {},
    effects: [],
    turn: undefined as never,
    pending: [],
    resume: [],
    winner: null,
    endReason: null,
    rules,
    nextId: 1,
  };
  s.turn = freshTurn(s);
  type NewCard = Card extends infer C ? (C extends Card ? Omit<C, "id"> : never) : never;
  const make = (c: NewCard): number => {
    const id = s.nextId++;
    s.cards[id] = { ...c, id } as Card;
    return id;
  };
  ([0, 1] as PlayerId[]).forEach((p) => {
    const list = opts.decks[p];
    const pl = s.players[p];
    for (const letter of list.units) pl.pool.push(make({ owner: p, kind: "unit", letter, unit: freshUnitState(letter) }));
    for (const v of DECK_RULES.numberValues)
      for (let k = 0; k < DECK_RULES.numberCopies; k++) pl.deck.push(make({ owner: p, kind: "num", value: v }));
    for (const sym of list.symbols) pl.deck.push(make({ owner: p, kind: "sym", sym }));
  });
  if (opts.stack || opts.first !== undefined) s.setupOpts = { stack: opts.stack, first: opts.first };
  return s;
}

function matchesDesc(c: Card, desc: string): boolean {
  if (c.kind === "num") return String(c.value) === desc;
  if (c.kind === "sym") return c.sym === desc;
  return c.letter === desc.toUpperCase() && /^[a-z]$/i.test(desc);
}

function stackDeck(s: GameState, p: PlayerId, descs: string[]): void {
  const deck = s.players[p].deck;
  const top: number[] = [];
  for (const d of descs) {
    const i = deck.findIndex((id) => matchesDesc(s.cards[id], d));
    if (i < 0) throw new Error(`stack: ${d} is not in deck`);
    top.push(deck.splice(i, 1)[0]);
  }
  deck.unshift(...top);
}

/** 両者の準備がそろったら、デックを作って 5 枚引き、先攻を決めて最初のターンへ */
function startGame(cx: Ctx): void {
  const s = cx.s;
  const ext = s.setupOpts ?? {};
  for (const p of [0, 1] as PlayerId[]) {
    const pl = s.players[p];
    const setup = pl.setup!;
    pl.main = setup.main;
    pl.subs = [...setup.subs];
    pl.deck.push(...pl.pool.filter((id) => id !== setup.main && !setup.subs.includes(id)));
    pl.pool = [];
  }
  emit(cx, { t: "reveal" });
  for (const p of [0, 1] as PlayerId[]) {
    const pl = s.players[p];
    shuffle(s, pl.deck);
    const stack = ext.stack?.[p];
    if (stack) stackDeck(s, p, stack);
    for (let tries = 0; ; tries++) {
      for (let i = 0; i < s.rules.openingHand; i++) drawOne(cx, p, s.rules.openingUnitsToSub);
      const hasNumber = pl.hand.some((id) => s.cards[id].kind === "num");
      if (hasNumber || !s.rules.mulligan || tries >= s.rules.mulliganMaxTries || stack) break;
      pl.deck.push(...pl.hand.splice(0));
      shuffle(s, pl.deck);
      emit(cx, { t: "mulligan", p });
    }
  }
  const fp = s.rules.firstPlayer;
  const first: PlayerId = ext.first ?? (fp === "p1" ? 0 : fp === "p2" ? 1 : (randInt(s, 2) as PlayerId));
  delete s.setupOpts;
  s.first = first;
  s.phase = "main";
  emit(cx, { t: "first", p: first });
  beginTurn(cx, first);
}

/** 効果に必要な選択。技は支払い後、記号はハンドから出したあとの状態で求める */
export function requestsForSkill(s: GameState, p: PlayerId, unit: number, payment: number[]): ChoiceRequest[] {
  const t = structuredClone(s);
  payCost({ s: t, events: [], trace: false }, p, payment, skillCost(s, p, unit));
  const u = unitCard(t, unit);
  return u ? choiceRequests(t, p, skillForm(u).ops) : [];
}

export function requestsForSymbol(s: GameState, p: PlayerId, cardId: number): ChoiceRequest[] {
  const c = s.cards[cardId];
  if (!c || c.kind !== "sym") return [];
  const t = structuredClone(s);
  t.players[p].hand = t.players[p].hand.filter((id) => id !== cardId);
  return choiceRequests(t, p, SYMBOLS[c.sym].ops);
}

function apply(cx: Ctx, a: Action): string | null {
  const s = cx.s;
  switch (a.type) {
    case "setup": {
      if (s.phase !== "setup") return "phase";
      const pl = s.players[a.player];
      if (pl.setup) return "alreadySetup";
      const ids = [a.main, ...a.subs];
      if (new Set(ids).size !== ids.length || !ids.every((id) => pl.pool.includes(id))) return "setupInvalid";
      if (a.subs.length > s.rules.subSlots) return "setupInvalid";
      pl.setup = { main: a.main, subs: [...a.subs] };
      if (s.players.every((x) => x.setup)) startGame(cx);
      return null;
    }
    case "placeNumber": {
      const e = canPlace(s, a.player, a.card);
      if (e) return e;
      const pl = s.players[a.player];
      pl.hand.splice(pl.hand.indexOf(a.card), 1);
      pl.storage.push(a.card);
      s.turn.numbersPlaced += 1;
      emit(cx, { t: "place", p: a.player, id: a.card });
      return null;
    }
    case "useSkill": {
      const e = canUseSkill(s, a.player, a.unit);
      if (e) return e;
      const cost = skillCost(s, a.player, a.unit);
      if (!isValidPayment(s, a.player, a.payment, cost)) return "payment";
      const reqs = requestsForSkill(s, a.player, a.unit, a.payment);
      if (!validateChoices(reqs, a.choices)) return "choices";
      emit(cx, { t: "skill", p: a.player, id: a.unit });
      payCost(cx, a.player, a.payment, cost);
      s.turn.skillsUsed += 1;
      if (s.rules.costReduceOnce) s.turn.costReduce = 0;
      const u = unitCard(s, a.unit)!;
      resolveOps(cx, a.player, skillForm(u).ops, a.choices ?? {});
      return null;
    }
    case "useSymbol": {
      const e = canUseSymbol(s, a.player, a.card);
      if (e) return e;
      const reqs = requestsForSymbol(s, a.player, a.card);
      if (!validateChoices(reqs, a.choices)) return "choices";
      const pl = s.players[a.player];
      const c = card(s, a.card);
      if (c.kind !== "sym") return "notSymbol";
      const def = SYMBOLS[c.sym];
      pl.hand.splice(pl.hand.indexOf(a.card), 1);
      pl.resolving = a.card;
      if (!def.free) s.turn.symbolsUsed += 1;
      emit(cx, { t: "symbol", p: a.player, id: a.card });
      resolveOps(cx, a.player, def.ops, a.choices ?? {});
      pl.resolving = null;
      pl.trash.push(a.card);
      emit(cx, { t: "symbolDone", p: a.player, id: a.card });
      return null;
    }
    case "endTurn": {
      const e = canEndTurn(s, a.player);
      if (e) return e;
      s.resume = ["auto", "needle", "tenure", "switch"];
      runResume(cx);
      return null;
    }
    case "chooseMain": {
      const pend = s.pending[0];
      if (!pend || pend.player !== a.player) return "notYourChoice";
      if (!mainCandidates(s, a.player).includes(a.card)) return "notCandidate";
      const pl = s.players[a.player];
      if (pl.subs.includes(a.card)) pl.subs.splice(pl.subs.indexOf(a.card), 1);
      else pl.hand.splice(pl.hand.indexOf(a.card), 1);
      pl.main = a.card;
      s.pending.shift();
      emit(cx, { t: "newMain", p: a.player, id: a.card });
      runResume(cx);
      return null;
    }
  }
}

export function applyAction(state: GameState, action: Action, opts: { trace?: boolean } = {}): ActionResult {
  const cx: Ctx = { s: structuredClone(state), events: [], trace: !!opts.trace };
  const error = apply(cx, action);
  if (error) return { ok: false, error, state, events: [] };
  return { ok: true, state: cx.s, events: cx.events };
}
