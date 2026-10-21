// 乱数（mulberry32）。状態は GameState.rng に持つので、同じ seed なら同じ結果になる。
import type { GameState } from "./types.ts";

export function rand(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(s: { rng: number }, n: number): number {
  return Math.floor(rand(s) * n);
}

export function shuffle<T>(s: { rng: number } | GameState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
