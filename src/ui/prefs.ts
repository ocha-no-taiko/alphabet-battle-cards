// ブラウザに残す設定（演出の速さ・自作デック・最後に選んだデック）。保存できない環境でも動くように try で包む。
import type { DeckList } from "../engine/types.ts";

export interface CustomDeck extends DeckList {
  id: string;
  name: string;
}

const KEY = "abc.prefs.v1";

/** 対戦の記録（トロフィーの条件に使う） */
export interface Progress {
  games: number;
  wins: number;
  losses: number;
  streak: number;
  bestStreak: number;
  kos: number;
  evolutions: number;
  hotseatGames: number;
  tutorialDone: boolean;
  deckWins: Record<string, number>;
  /** 手に入れたトロフィー（id → 日時） */
  trophies: Record<string, string>;
}

export const prefs: {
  speed: number;
  sound: boolean;
  decks: CustomDeck[];
  lastDeck: string;
  lastDeck2: string;
  /** カードの裏面（トロフィーで手に入る。"" は標準） */
  cardBack: string;
  progress: Progress;
} = {
  speed: 1,
  sound: true,
  decks: [],
  lastDeck: "starter",
  lastDeck2: "diagonal",
  cardBack: "",
  progress: {
    games: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0, kos: 0, evolutions: 0, hotseatGames: 0,
    tutorialDone: false, deckWins: {}, trophies: {},
  },
};

try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    Object.assign(prefs, { ...saved, progress: { ...prefs.progress, ...(saved.progress ?? {}) } });
  }
} catch {
  // 読めなければ既定値のまま
}

export function savePrefs(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // 保存できなくても続ける
  }
}
