// トロフィーカード。対戦の記録を prefs.progress に足して、条件（trophies.json）を満たしたものを手に入れる。
import trophiesJson from "../data/trophies.json" with { type: "json" };
import { DECK_PRESETS } from "../engine/data.ts";
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
}

export function newRecord(): GameRecord {
  return { maxHit: 0, evolves: 0, kos: 0, wildcard: 0, payCounts: {} };
}

/** 操作 1 回ぶんのイベントを記録に足す。me は人のプレイヤー */
export function track(rec: GameRecord, before: GameState, action: Action, events: GameEvent[], me: 0 | 1): void {
  if (action.type === "useSkill" && action.player === me && action.payment.length === 1) {
    const c = before.cards[action.payment[0]];
    if (c.kind === "num" && c.value === 0) rec.wildcard = Math.max(rec.wildcard, skillCost(before, me, action.unit));
  }
  for (const ev of events) {
    if (ev.t === "damage" && ev.p !== me && !ev.reflected) rec.maxHit = Math.max(rec.maxHit, ev.amount);
    if (ev.t === "evolve" && ev.p === me) rec.evolves++;
    if (ev.t === "ko" && ev.p !== me) rec.kos++;
    if (ev.t === "pay" && ev.p === me) {
      for (const id of [...ev.ids, ...(ev.kept ? [ev.kept.id] : [])]) rec.payCounts[id] = (rec.payCounts[id] ?? 0) + 1;
    }
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
