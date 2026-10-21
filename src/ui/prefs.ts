// ブラウザに残す設定（演出の速さ・自作デック・最後に選んだデック）。保存できない環境でも動くように try で包む。
import type { DeckList } from "../engine/types.ts";

export interface CustomDeck extends DeckList {
  id: string;
  name: string;
}

const KEY = "abc.prefs.v1";

export const prefs: { speed: number; decks: CustomDeck[]; lastDeck: string; lastDeck2: string } = {
  speed: 1,
  decks: [],
  lastDeck: "starter",
  lastDeck2: "diagonal",
};

try {
  const raw = localStorage.getItem(KEY);
  if (raw) Object.assign(prefs, JSON.parse(raw));
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
