// CPU 同士で 1 戦を最後まで進める（シミュレーターとテスト用）。
import { cpuAction, makeCpu, type CpuLevel } from "../ai/cpu.ts";
import type { Rules } from "../engine/data.ts";
import { applyAction, createGame } from "../engine/game.ts";
import { waitingFor } from "../engine/query.ts";
import type { DeckList, GameState } from "../engine/types.ts";

export interface PlayResult {
  state: GameState;
  turns: number;
  actions: number;
}

export function playGame(
  decks: [DeckList, DeckList],
  seed: number,
  opts: { rules?: Partial<Rules>; levels?: [CpuLevel, CpuLevel]; maxActions?: number } = {},
): PlayResult {
  let s = createGame({ decks, seed, rules: opts.rules });
  const levels = opts.levels ?? ["normal", "normal"];
  const cpus = [makeCpu(levels[0], seed * 7 + 1), makeCpu(levels[1], seed * 13 + 5)];
  const max = opts.maxActions ?? 5000;
  let n = 0;
  while (s.phase !== "over" && n < max) {
    const p = waitingFor(s)[0];
    const r = applyAction(s, cpuAction(s, p, cpus[p]));
    if (!r.ok) throw new Error(`CPU chose an illegal action: ${r.error}`);
    s = r.state;
    n++;
  }
  return { state: s, turns: s.turnNumber, actions: n };
}
