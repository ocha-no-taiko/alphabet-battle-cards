// 作品紹介動画（1920×1080・30fps・H.264）を、実際のゲームを自動で遊ぶ様子から撮る。
// 画面の更新を時刻つきのコマ（JPEG）で受け取り、ffmpeg で一定のコマ数の MP4 にする。
// 先に abc-play（開発サーバ）を動かしておく。  使い方: npm run video
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BASE, caption, clearCaption, clickEl, hideCursor, installHelpers, launch, prefsFor, showCursor, sleep, waitFor,
} from "./lib.mjs";

const OUT = fileURLToPath(new URL("./out/", import.meta.url));
const FRAMES = `${OUT}frames/`;
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

// 勝利のときにトロフィーの獲得演出を出さないよう、このマッチで取れそうなトロフィーは最初から持っている状態にする。
// （コレクションの場面で、ほどよく集まって見えるようにもなる）
const LOCKED = new Set(["tutorial", "hotseat", "all-letters", "all-symbols", "complete", "straight", "needle-ko", "reflect-ko",
  "jackpot-9", "revive", "last-stand", "one-shot", "losses-7"]);
const ALL_IDS = JSON.parse(readFileSync(new URL("../src/data/trophies.json", import.meta.url), "utf8")).trophies.map((x) => x.id);
const owned = Object.fromEntries(ALL_IDS.filter((id) => !LOCKED.has(id)).map((id) => [id, "2026-10-20T12:00:00.000Z"]));
const { browser, page } = await launch(
  prefsFor({
    games: 31, wins: 22, losses: 3, streak: 4, bestStreak: 6, kos: 131, evolutions: 58,
    deckWins: { starter: 6, diagonal: 5, mixed: 4, fortress: 3, trickster: 4 }, trophies: owned,
  }),
);

// ---- 録画（CDP の screencast）----
const cdp = await page.createCDPSession();
const frames = [];
let writing = Promise.resolve();
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const i = frames.length;
  const file = `${FRAMES}${String(i).padStart(6, "0")}.jpg`;
  frames.push({ file, t: metadata.timestamp });
  writing = writing.then(() => writeFileSync(file, Buffer.from(data, "base64")));
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

async function startRec() {
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
}
async function stopRec() {
  await cdp.send("Page.stopScreencast");
  await writing;
}

/** 画面上の背景のカードの位置（クリック用） */
async function floatingCardPoint() {
  return page.evaluate(() => {
    const f = window.__flip;
    for (const a of f.ambient) {
      const v = a.group.position.clone().project(f.camera);
      const x = ((v.x + 1) / 2) * innerWidth;
      const y = ((1 - v.y) / 2) * innerHeight;
      const el = document.elementFromPoint(x, y);
      if (x > 120 && x < innerWidth - 120 && y > 150 && y < innerHeight - 150 && !el?.closest(".menu, .btn, .logo-art, .full-name, .tagline")) return { x, y };
    }
    return null;
  });
}

async function clickAt(x, y) {
  await showCursor(page, x, y);
  await sleep(550);
  await page.evaluate(() => {
    const c = document.querySelector(".promo-cursor");
    c?.classList.remove("click");
    void c?.offsetWidth;
    c?.classList.add("click");
  });
  await page.mouse.click(x, y);
}

/** 自分のターンになるまで待つ。途中でメインを選ぶ画面が出たら選ぶ（撮影が止まらないように） */
async function untilMyTurn(timeout = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const st = await page.evaluate(() => ({
      mine: window.__promo.myTurn(),
      choose: !!document.querySelector(".choose-dlg .pick"),
      over: window.__abc.s.phase === "over",
    }));
    if (st.mine || st.over) return st;
    if (st.choose) {
      await clickEl(page, ".choose-dlg .pick", { moveMs: 400 });
      await hideCursor(page);
    }
    await sleep(120);
  }
  throw new Error("my turn did not come");
}

/** 自分のターンのハンドに、指定のカードを入れておく（撮影用の段取り） */
async function stageHand(spec) {
  await page.evaluate((spec) => {
    const P = window.__promo;
    const me = window.__abc.s.players[0];
    for (const v of spec.nums ?? []) {
      const c = P.find(0, (c) => c.kind === "num" && c.value === v && !me.hand.includes(c.id) && !me.storage.includes(c.id));
      if (c) P.move(c, "hand");
    }
    for (const k of spec.syms ?? []) {
      const c = P.sym(0, k);
      if (c && !me.hand.includes(c.id)) P.move(c, "hand");
    }
    P.render();
  }, spec);
}

// ---- 撮影（台本の 11 シーン）----
// 1 本文、2 行目は小さい補足。
const SCRIPT = {
  title: ["アルファベットで戦う、<br>2 人用カードゲーム。", "キャラを覚える必要なし。"],
  deck: ["まずは、デッキを組む。", "アルファベットは 7 文字、記号は 13 文字。"],
  setup: ["バトル前に、<br>メインとサブを選ぶ。", "ここで戦い方を決める。"],
  energy: ["数字で、<br>エネルギーを蓄える。", "蓄えられる数字は、1 ターンに 1 枚。"],
  skill: ["スキルを、数字で払う。", "0 は、どんなコストでも払えるワイルドカード。"],
  symbol: ["記号を使うと、特殊効果。", "攻撃、防御、妨害が可能。"],
  auto: ["ターン終了で、<br>自動ダメージ。", "ここまでを、繰り返す。"],
  evolve: ["アルファベットは、<br>進化する。", "小文字から、大文字へ。"],
  lethal: ["LETHAL は、<br>トドメの合図。", "運命を、受け入れよう。"],
  win: ["5 回撃破で、勝利。", "5〜10 分で、サクサクプレイ。"],
  collection: ["35 種類のトロフィーと、<br>10 種類のカードデザイン。", "やり込み要素も、もちろん収録。"],
};
const cap = (key, pos = "top") => caption(page, SCRIPT[key][0], SCRIPT[key][1], pos);

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await startRec();
await installHelpers(page);
await waitFor(page, () => !!document.querySelector(".logo-art"));

// 1. タイトル
await sleep(2400);
await cap("title", "bottom");
await sleep(800);
await showCursor(page, 1500, 900);
await sleep(300);
await clickEl(page, ".logo-art");
await sleep(1200);
const pt = await floatingCardPoint();
if (pt) await clickAt(pt.x, pt.y);
await sleep(1200);
await page.keyboard.type("abc", { delay: 120 });
await sleep(1600);
await clearCaption(page);

// 2. デック編集
await clickEl(page, "[data-go=deck]");
await waitFor(page, () => !!document.querySelector(".deck .pick") && !document.querySelector(".fx-curtain"));
await cap("deck", "bottom");
await sleep(900);
for (const sel of ['.deck .pick[data-unit="M"]', '.deck .pick[data-unit="Z"]', '.deck .pick[data-sym="%"]', '.deck .pick[data-sym="<>"]']) {
  await clickEl(page, sel, { moveMs: 500 });
  await sleep(650);
}
await sleep(800);
await clearCaption(page);
await clickEl(page, ".deck [data-back]");
await hideCursor(page);
await waitFor(page, () => !!document.querySelector("[data-go=cpu]") && !document.querySelector(".fx-curtain"));
await sleep(600);

// 3. メインとサブを選ぶ
await clickEl(page, "[data-go=cpu]");
await sleep(700);
await page.select('[data-sel="cpu"]', "preset:diagonal");
await clickEl(page, "[data-start=cpu]");
await waitFor(page, () => !!document.querySelector(".pool-item") && !document.querySelector(".fx-curtain"));
await page.evaluate(() => (window.__abc.s.setupOpts = { ...(window.__abc.s.setupOpts ?? {}), first: 0 }));
await cap("setup");
await sleep(1100);
for (const i of [0, 5, 6]) {
  await clickEl(page, `.pool-item:nth-child(${i + 1})`, { moveMs: 450 });
  await sleep(380);
}
await sleep(500);
await clickEl(page, ".setup-dlg [data-go]");
await hideCursor(page);
await sleep(1200);
await clearCaption(page);
await untilMyTurn();
await sleep(500);

// 4. 数字を置く（0 を置いて、次のシーンで使う）
await stageHand({ nums: [0, 3, 7], syms: ["%", "!"] });
await cap("energy");
await sleep(1000);
await clickEl(page, '.hand.me [data-tut="card-n0"]');
await sleep(2000);

// 5. スキルを数字で払う（0 で払う）
await cap("skill");
await sleep(900);
await clickEl(page, ".row.me .main-slot .card");
await sleep(2200);
await clickEl(page, ".skill-dlg [data-go]");
await sleep(2400);

// 6. 記号
await cap("symbol");
await sleep(900);
await clickEl(page, '.hand.me [data-tut="card-s%"]');
await sleep(1500);
await clickEl(page, ".symbol-dlg [data-go]");
await sleep(2400);

// 7. ターン終了で自動ダメージ
await cap("auto");
await sleep(900);
await clickEl(page, "[data-end]");
await hideCursor(page);
await sleep(2800);
await untilMyTurn();
await clearCaption(page);
await sleep(400);

// 8. 進化
await page.evaluate(() => {
  const a = window.__promo.unit(0, "A");
  a.unit.tenure = Math.max(a.unit.tenure, 2);
  window.__promo.render();
});
await cap("evolve");
await sleep(1500);
await clickEl(page, "[data-end]");
await hideCursor(page);
await waitFor(page, () => !!document.querySelector(".banner.evolve"));
await sleep(2200);
await clearCaption(page);
await untilMyTurn();
await sleep(400);

// 9. LETHAL → K.O.（このあと MATCH POINT が出る）
await page.evaluate(() => {
  const s = window.__abc.s;
  s.players[0].kos = 3;
  const mine = s.cards[s.players[0].main];
  mine.unit.hp = mine.unit.maxHp; // 撮影の途中で自分が倒されないように
  const m = s.cards[s.players[1].main];
  m.unit.hp = Math.min(m.unit.hp, 6);
  window.__promo.render();
});
await cap("lethal");
await sleep(2800);
await clickEl(page, "[data-end]");
await hideCursor(page);
await waitFor(page, () => !!document.querySelector(".banner.match"), 20000);
await sleep(1800);
await clearCaption(page);
await untilMyTurn();
await sleep(400);

// 10. 5 回撃破で勝利（トロフィーは取らない状態にしてあるので、そのまま結果へ）
await page.evaluate(() => {
  const s = window.__abc.s;
  const m = s.cards[s.players[1].main];
  m.unit.hp = Math.min(m.unit.hp, 6);
  window.__promo.render();
});
await cap("win");
await sleep(1800);
await clickEl(page, "[data-end]");
await hideCursor(page);
await waitFor(page, () => !!document.querySelector(".over-dlg"), 30000);
await sleep(2600);
await clearCaption(page);

// 11. コレクション
await clickEl(page, ".over-dlg [data-title]");
await waitFor(page, () => !!document.querySelector("[data-go=collection]") && !document.querySelector(".fx-curtain"));
await sleep(900);
await clickEl(page, "[data-go=collection]");
await waitFor(page, () => !!document.querySelector(".trophy-item") && !document.querySelector(".fx-curtain"));
await cap("collection", "bottom");
await sleep(900);
await clickEl(page, '.trophy-item[data-t="wins-20"]');
await sleep(2000);
for (const b of ["royal", "matrix", "flame"]) {
  await clickEl(page, `.back-item[data-back="${b}"]`, { moveMs: 450 });
  await sleep(900);
}
await sleep(2200);
await hideCursor(page);
await stopRec();
await browser.close();

// ---- MP4 にする ----
const list = [];
for (let i = 0; i < frames.length; i++) {
  const d = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : 1 / 30;
  list.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, d).toFixed(4)}`);
}
list.push(`file '${frames[frames.length - 1].file}'`);
writeFileSync(`${FRAMES}list.txt`, list.join("\n"));
const total = frames[frames.length - 1].t - frames[0].t;
const out = `${OUT}abc-intro.mp4`;
execFileSync(
  "ffmpeg",
  [
    "-y", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", `${FRAMES}list.txt`,
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    "-vf", `fps=30,scale=1920:1080:flags=lanczos,fade=t=in:st=0:d=0.6,fade=t=out:st=${(total - 1).toFixed(2)}:d=1,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-r", "30",
    "-c:a", "aac", "-b:a", "128k", "-shortest",
    "-movflags", "+faststart",
    out,
  ],
  { stdio: "inherit" },
);
console.log(`${frames.length} コマ・${total.toFixed(1)} 秒 → abc-intro.mp4 ${(statSync(out).size / 1024 / 1024).toFixed(1)} MB`);
rmSync(FRAMES, { recursive: true, force: true });
