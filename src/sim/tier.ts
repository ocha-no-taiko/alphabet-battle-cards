// カードごとの強さ（ティア表の元データ）。ランダムなデック同士で CPU に対戦させ、
// 「そのカードが入っていたデックの勝率」と「1 戦あたりの使用回数」をカードごとに集計する。
// 使い方: npm run tier -- --games 3000 --seed 1 --out tier.json
import { writeFileSync } from "node:fs";
import { cpuAction, makeCpu } from "../ai/cpu.ts";
import { LETTERS, SYMBOL_IDS } from "../engine/data.ts";
import { applyAction, createGame } from "../engine/game.ts";
import { waitingFor } from "../engine/query.ts";
import { rand } from "../engine/rng.ts";
import type { DeckList, PlayerId } from "../engine/types.ts";

const args = process.argv.slice(2);
const opt = (name: string, d: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : d;
};
const games = Number(opt("games", "2000"));
const seed0 = Number(opt("seed", "1"));
const out = opt("out", "");

interface Stat {
  n: number; // 入っていたデックの数
  w: number; // そのうち勝った数
  uses: number; // 使った回数（技の発動・記号の使用）
}
const units = new Map<string, Stat>(LETTERS.map((l) => [l, { n: 0, w: 0, uses: 0 }]));
const syms = new Map<string, Stat>(SYMBOL_IDS.map((s) => [s, { n: 0, w: 0, uses: 0 }]));

function pickN<T>(r: { rng: number }, xs: T[], n: number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(r) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const r = { rng: seed0 >>> 0 };
let done = 0;
let unfinished = 0;
let turns = 0;
const t0 = performance.now();
for (let g = 0; g < games; g++) {
  const decks: [DeckList, DeckList] = [0, 1].map(() => ({ units: pickN(r, LETTERS, 7), symbols: pickN(r, SYMBOL_IDS, 13) })) as [DeckList, DeckList];
  const seed = seed0 * 100003 + g;
  let s = createGame({ decks, seed });
  const cpus = [makeCpu("normal", seed * 7 + 1), makeCpu("normal", seed * 13 + 5)];
  const used: [Map<string, number>, Map<string, number>] = [new Map(), new Map()];
  let n = 0;
  while (s.phase !== "over" && n < 4000) {
    const p = waitingFor(s)[0];
    const a = cpuAction(s, p, cpus[p]);
    if (a.type === "useSkill") {
      const c = s.cards[a.unit];
      if (c.kind === "unit") used[p].set(`u${c.letter}`, (used[p].get(`u${c.letter}`) ?? 0) + 1);
    } else if (a.type === "useSymbol") {
      const c = s.cards[a.card];
      if (c.kind === "sym") used[p].set(`s${c.sym}`, (used[p].get(`s${c.sym}`) ?? 0) + 1);
    }
    const res = applyAction(s, a);
    if (!res.ok) throw new Error(res.error);
    s = res.state;
    n++;
  }
  if (s.phase !== "over") {
    unfinished++;
    continue;
  }
  done++;
  turns += s.turnNumber;
  for (const p of [0, 1] as PlayerId[]) {
    const won = s.winner === p ? 1 : 0;
    for (const l of decks[p].units) {
      const st = units.get(l)!;
      st.n++;
      st.w += won;
      st.uses += used[p].get(`u${l}`) ?? 0;
    }
    for (const x of decks[p].symbols) {
      const st = syms.get(x)!;
      st.n++;
      st.w += won;
      st.uses += used[p].get(`s${x}`) ?? 0;
    }
  }
  if ((g + 1) % 250 === 0) console.error(`${g + 1}/${games}  ${((performance.now() - t0) / 1000).toFixed(0)}s`);
}

const rows = (m: Map<string, Stat>) =>
  [...m].map(([id, st]) => {
    const p = st.w / Math.max(1, st.n);
    return { id, decks: st.n, winRate: p, ci95: 1.96 * Math.sqrt((p * (1 - p)) / Math.max(1, st.n)), usesPerGame: st.uses / Math.max(1, st.n) };
  }).sort((a, b) => b.winRate - a.winRate);

const result = {
  games,
  finished: done,
  unfinished,
  avgTurns: turns / Math.max(1, done),
  seconds: (performance.now() - t0) / 1000,
  units: rows(units),
  symbols: rows(syms),
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`games ${games}（決着 ${done}・未決着 ${unfinished}）平均 ${result.avgTurns.toFixed(1)} ターン  ${result.seconds.toFixed(0)}s`);
console.log("ユニット");
for (const u of result.units) console.log(`  ${u.id}  勝率 ${pct(u.winRate)} ±${pct(u.ci95)}  使用 ${u.usesPerGame.toFixed(2)}/戦`);
console.log("記号");
for (const x of result.symbols) console.log(`  ${x.id.padEnd(2)}  勝率 ${pct(x.winRate)} ±${pct(x.ci95)}  使用 ${x.usesPerGame.toFixed(2)}/戦`);
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
