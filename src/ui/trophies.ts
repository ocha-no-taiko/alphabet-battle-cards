// トロフィーカード。対戦の記録を prefs.progress に足して、条件（trophies.json）を満たしたものを手に入れる。
import trophiesJson from "../data/trophies.json" with { type: "json" };
import { DECK_PRESETS, UNITS } from "../engine/data.ts";
import { skillCost } from "../engine/query.ts";
import type { Action, GameEvent, GameState } from "../engine/types.ts";
import type { TrophyDef } from "./ascii.ts";
import { prefs, savePrefs } from "./prefs.ts";

export const TROPHIES = trophiesJson.trophies as TrophyDef[];

/** 1 回の対戦の記録（人 = P1 から見た値） */
export interface GameRecord {
  maxHit: number;
  evolves: number;
  kos: number;
  wildcard: number;
  payCounts: Record<number, number>;
  symbolKO: boolean;
  needleKO: boolean;
  reflectKO: boolean;
  oneShot: boolean;
  gambleNine: boolean;
  revives: number;
  allAttrs: boolean;
  zorome: number;
  sevens: number;
  straight: boolean;
  /** いまのターンの持ち主と、そのターン内の記録 */
  turnOwner: number;
  turnKOs: number;
  turnDamage: number;
  turnSymbols: number;
  maxTurnKOs: number;
  maxTurnDamage: number;
  maxTurnSymbols: number;
  letters: string[];
  symbols: string[];
}

export function newRecord(): GameRecord {
  return {
    maxHit: 0, evolves: 0, kos: 0, wildcard: 0, payCounts: {},
    symbolKO: false, needleKO: false, reflectKO: false, oneShot: false, gambleNine: false, revives: 0,
    allAttrs: false, zorome: 0, sevens: 0, straight: false,
    turnOwner: -1, turnKOs: 0, turnDamage: 0, turnSymbols: 0, maxTurnKOs: 0, maxTurnDamage: 0, maxTurnSymbols: 0,
    letters: [], symbols: [],
  };
}

function add(list: string[], x: string): void {
  if (!list.includes(x)) list.push(x);
}

/** 操作 1 回ぶんのイベントを記録に足す。me は人のプレイヤー、after は操作のあとの状態 */
export function track(rec: GameRecord, before: GameState, action: Action, events: GameEvent[], me: 0 | 1, after: GameState): void {
  if (action.type === "useSkill" && action.player === me) {
    const u = before.cards[action.unit];
    if (u.kind === "unit") add(rec.letters, u.letter);
    if (action.payment.length === 1) {
      const c = before.cards[action.payment[0]];
      if (c.kind === "num" && c.value === 0) rec.wildcard = Math.max(rec.wildcard, skillCost(before, me, action.unit));
    }
  }
  if (action.type === "useSymbol" && action.player === me) {
    const c = before.cards[action.card];
    if (c.kind === "sym") add(rec.symbols, c.sym);
  }
  const lastDamage = new Map<number, GameEvent & { t: "damage" }>();
  for (const ev of events) {
    if (ev.t === "turn") {
      rec.turnOwner = ev.p;
      rec.turnKOs = rec.turnDamage = rec.turnSymbols = 0;
    }
    const myTurn = rec.turnOwner === me;
    if (ev.t === "damage" && ev.p !== me) {
      lastDamage.set(ev.p, ev);
      if (!ev.src) rec.maxHit = Math.max(rec.maxHit, ev.amount);
      if (myTurn) rec.maxTurnDamage = Math.max(rec.maxTurnDamage, (rec.turnDamage += ev.amount));
      // 一撃必殺: 満タンのメインを 1 回のダメージで倒した
      const t = before.cards[ev.id];
      if (t?.kind === "unit" && t.unit.hp === t.unit.maxHp && ev.amount >= t.unit.maxHp) rec.oneShot = true;
    }
    if (ev.t === "evolve" && ev.p === me) rec.evolves++;
    if (ev.t === "ko" && ev.p !== me) {
      rec.kos++;
      if (myTurn) rec.maxTurnKOs = Math.max(rec.maxTurnKOs, ++rec.turnKOs);
      if (action.type === "useSymbol" && action.player === me) rec.symbolKO = true;
      const src = lastDamage.get(ev.p)?.src;
      if (src === "needle") rec.needleKO = true;
      if (src === "reflect") rec.reflectKO = true;
    }
    if (ev.t === "symbol" && ev.p === me && myTurn) rec.maxTurnSymbols = Math.max(rec.maxTurnSymbols, ++rec.turnSymbols);
    if (ev.t === "revive" && ev.p === me && action.type === "useSkill") rec.revives++;
    if (ev.t === "draw" && ev.p === me && action.type === "useSkill" && action.player === me) {
      const u = before.cards[action.unit];
      const c = after.cards[ev.id];
      if (u.kind === "unit" && u.letter === "G" && c.kind === "num" && c.value === 9) rec.gambleNine = true;
    }
    if (ev.t === "pay" && ev.p === me) {
      for (const id of [...ev.ids, ...(ev.kept ? [ev.kept.id] : [])]) rec.payCounts[id] = (rec.payCounts[id] ?? 0) + 1;
    }
  }
  // 操作のあとの場とストレージ
  const pl = after.players[me];
  const attrs = new Set([pl.main, ...pl.subs].flatMap((id) => (id !== null && after.cards[id].kind === "unit" ? [UNITS[(after.cards[id] as { letter: string }).letter].attr] : [])));
  if (attrs.size >= 4) rec.allAttrs = true;
  const values = pl.storage.map((id) => (after.cards[id] as { value: number }).value);
  const counts = values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<number, number>());
  rec.zorome = Math.max(rec.zorome, ...counts.values(), 0);
  rec.sevens = Math.max(rec.sevens, counts.get(7) ?? 0);
  if (values.length === 5) {
    const v = [...values].sort((a, b) => a - b);
    if (v.every((x, i) => i === 0 || x === v[i - 1] + 1)) rec.straight = true;
  }
}

function has(id: string): boolean {
  return !!prefs.progress.trophies[id];
}

function meets(t: TrophyDef, rec: GameRecord | null, s: GameState | null, won: boolean): boolean {
  const P = prefs.progress;
  const c = t.cond as { stat?: string; game?: string; min?: number; max?: number };
  const min = c.min ?? 0;
  if (c.stat) {
    switch (c.stat) {
      case "tutorialDone": return P.tutorialDone;
      case "deckWins": return DECK_PRESETS.every((d) => (P.deckWins[d.id] ?? 0) > 0);
      case "allTrophies": return TROPHIES.every((x) => x.id === t.id || has(x.id));
      case "lettersUsed": return P.lettersUsed.length >= min;
      case "symbolsUsed": return P.symbolsUsed.length >= min;
      default: return ((P as unknown as Record<string, number>)[c.stat] ?? 0) >= min;
    }
  }
  if (!rec || !s) return false;
  switch (c.game) {
    case "maxHit": return rec.maxHit >= min;
    case "evolves": return rec.evolves >= min;
    case "wildcard": return rec.wildcard >= min;
    case "sameCardPays": return Object.values(rec.payCounts).some((n) => n >= min);
    case "perfect": return won && s.players[1].kos === 0;
    case "speed": return won && s.turnNumber <= (c.max ?? 0);
    case "comeback": return won && s.players[1].kos >= min;
    case "symbolKO": return rec.symbolKO;
    case "needleKO": return rec.needleKO;
    case "reflectKO": return rec.reflectKO;
    case "oneShot": return rec.oneShot;
    case "gambleNine": return rec.gambleNine;
    case "revive": return rec.revives >= min;
    case "allAttrs": return rec.allAttrs;
    case "zorome": return rec.zorome >= min;
    case "sevens": return rec.sevens >= min;
    case "straight": return rec.straight;
    case "turnKOs": return rec.maxTurnKOs >= min;
    case "turnDamage": return rec.maxTurnDamage >= min;
    case "turnSymbols": return rec.maxTurnSymbols >= min;
    case "lowHpWin": {
      const m = s.players[0].main;
      const u = m === null ? null : s.cards[m];
      return won && u?.kind === "unit" && u.unit.hp <= (c.max ?? 0);
    }
  }
  return false;
}

/** 条件を満たしたトロフィーを手に入れて、新しく手に入ったものを返す */
function award(rec: GameRecord | null, s: GameState | null, won: boolean): TrophyDef[] {
  const got: TrophyDef[] = [];
  // 「コンプリート」はほかのトロフィーのあとで判定する
  for (let pass = 0; pass < 2; pass++) {
    for (const t of TROPHIES) {
      if (has(t.id) || !meets(t, rec, s, won)) continue;
      prefs.progress.trophies[t.id] = new Date().toISOString();
      got.push(t);
    }
  }
  savePrefs();
  return got;
}

/** CPU 戦（チュートリアルの続きを含む）が終わったとき */
export function finishCpuGame(rec: GameRecord, s: GameState, deckId: string | null): TrophyDef[] {
  const P = prefs.progress;
  const won = s.winner === 0;
  P.games++;
  P.kos += rec.kos;
  P.evolutions += rec.evolves;
  for (const l of rec.letters) add(P.lettersUsed, l);
  for (const x of rec.symbols) add(P.symbolsUsed, x);
  if (won) {
    P.wins++;
    P.streak++;
    P.bestStreak = Math.max(P.bestStreak, P.streak);
    if (deckId) P.deckWins[deckId] = (P.deckWins[deckId] ?? 0) + 1;
  } else {
    P.losses++;
    P.streak = 0;
  }
  return award(rec, s, won);
}

export function finishHotseatGame(): TrophyDef[] {
  prefs.progress.hotseatGames++;
  return award(null, null, false);
}

export function finishTutorial(): TrophyDef[] {
  prefs.progress.tutorialDone = true;
  return award(null, null, false);
}

export function trophyCount(): { got: number; total: number } {
  return { got: TROPHIES.filter((t) => has(t.id)).length, total: TROPHIES.length };
}

/** 使える裏面（標準 + 手に入れたトロフィーのもの） */
export function unlockedBacks(): string[] {
  return ["", ...TROPHIES.filter((t) => t.back && has(t.id)).map((t) => t.back!)];
}

export function hasTrophy(id: string): boolean {
  return has(id);
}
