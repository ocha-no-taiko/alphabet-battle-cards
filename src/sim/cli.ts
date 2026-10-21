// ヘッドレスのシミュレーター。CPU 同士で多数の対戦を回して、勝率とターン数を集計する。
// 使い方: npm run sim -- --games 200 --seed 1 [--decks starter,diagonal] [--no-first-auto]
import { DECK_PRESETS } from "../engine/data.ts";
import { playGame } from "./play.ts";

const args = process.argv.slice(2);
const opt = (name: string, d: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : d;
};
const games = Number(opt("games", "200"));
const seed0 = Number(opt("seed", "1"));
const ids = opt("decks", DECK_PRESETS.map((d) => d.id).join(",")).split(",");
const presets = ids.map((id) => {
  const d = DECK_PRESETS.find((x) => x.id === id);
  if (!d) throw new Error(`unknown deck ${id}`);
  return d;
});
const rules = args.includes("--no-first-auto") ? { firstTurnAutoDamage: false } : undefined;

const wins = new Map<string, { w: number; n: number }>();
let firstWins = 0;
let turnsSum = 0;
let reasonNo = 0;
let unfinished = 0;
const t0 = performance.now();
for (let g = 0; g < games; g++) {
  const a = presets[g % presets.length];
  const b = presets[Math.floor(g / presets.length) % presets.length];
  const r = playGame([a, b], seed0 + g, { rules });
  if (r.state.phase !== "over") {
    unfinished++;
    continue;
  }
  const w = r.state.winner!;
  if (w === r.state.first) firstWins++;
  if (r.state.endReason === "noUnits") reasonNo++;
  turnsSum += r.turns;
  for (const [p, d] of [[0, a], [1, b]] as const) {
    const e = wins.get(d.id) ?? { w: 0, n: 0 };
    e.n++;
    if (w === p) e.w++;
    wins.set(d.id, e);
  }
}
const done = games - unfinished;
const pct = (x: number, n: number) => `${((100 * x) / Math.max(1, n)).toFixed(1)}%`;
console.log(`games ${games}（未決着 ${unfinished}）  ${((performance.now() - t0) / 1000).toFixed(1)}s`);
console.log(`先攻の勝率 ${pct(firstWins, done)}  平均ターン数 ${(turnsSum / Math.max(1, done)).toFixed(1)}  ユニット切れの決着 ${pct(reasonNo, done)}`);
for (const [id, e] of wins) console.log(`  ${id.padEnd(10)} 勝率 ${pct(e.w, e.n)}（${e.n} 戦）`);
