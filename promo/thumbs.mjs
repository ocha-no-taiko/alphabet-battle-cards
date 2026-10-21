// 作品ページ用のサムネイル（1920×1080 の PNG を 5 枚）を、実際のゲーム画面から撮る。
// 先に abc-play（開発サーバ）を動かしておく。  使い方: npm run thumbs
import { mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { caption, clickEl, launch, prefsFor, screenshot, sleep, startCpuGame, waitFor, waitMyTurn } from "./lib.mjs";

const OUT = fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(OUT, { recursive: true });

/** 見栄えのする盤面にする（自分は進化した A とサブ 3 体、相手はあと少しで倒れる Z） */
async function richBoard(page, { lethal = true, myKos = 4, oppKos = 2, evolved = true } = {}) {
  await page.evaluate(
    ({ lethal, myKos, oppKos, evolved }) => {
      const P = window.__promo;
      const s = window.__abc.s;
      const me = s.players[0];
      const opp = s.players[1];
      // 自分の場
      const a = P.unit(0, "A");
      P.move(a, "main");
      if (evolved) Object.assign(a.unit, { evolved: true, maxHp: 70, hp: 52, tenure: 4 });
      for (const l of ["C", "S", "H"]) {
        const u = P.unit(0, l);
        if (!me.subs.includes(u.id)) P.move(u, "sub");
        u.unit.tenure = 2;
      }
      while (me.subs.length > 3) P.move(s.cards[me.subs[0]], "deck");
      // ストレージ（9 はお釣りで残り 6）
      for (const id of [...me.storage]) P.move(s.cards[id], "deck");
      const nine = P.num(0, 9);
      P.move(nine, "storage");
      nine.spent = 3;
      for (const v of [4, 7, 0]) P.move(P.num(0, v), "storage");
      // ハンド
      for (const id of [...me.hand]) P.move(s.cards[id], "deck");
      for (const v of [2, 5, 8]) P.move(P.num(0, v, me.storage), "hand");
      for (const k of ["%", "!", "+"]) P.move(P.sym(0, k), "hand");
      // 相手の場
      const z = P.unit(1, "Z");
      P.move(z, "main");
      Object.assign(z.unit, { evolved: true, maxHp: 65, hp: lethal ? 14 : 58, tenure: 3 });
      for (const l of ["K", "X"]) {
        const u = P.unit(1, l);
        if (!opp.subs.includes(u.id)) P.move(u, "sub");
      }
      while (opp.subs.length > 2) P.move(s.cards[opp.subs[0]], "deck");
      for (const id of [...opp.storage]) P.move(s.cards[id], "deck");
      for (const v of [3, 6]) P.move(P.num(1, v), "storage");
      me.kos = myKos;
      opp.kos = oppKos;
      s.turnNumber = 9;
      P.render();
    },
    { lethal, myKos, oppKos, evolved },
  );
}

async function shot(name, fn, prefs) {
  const { browser, page } = await launch(prefs);
  try {
    await fn(page);
    const path = `${OUT}${name}.png`;
    await screenshot(page, path);
    console.log(`${name}.png  ${(statSync(path).size / 1024 / 1024).toFixed(2)} MB`);
  } finally {
    await browser.close();
  }
}

// 1. タイトル（キービジュアル）: メニューを隠して、ロゴと舞うカードだけにする
await shot("01-title", async (page) => {
  await page.addStyleTag({ content: ".title .menu, .title .footer, .sound-toggle { display: none !important; } .title .tagline { margin-bottom: 0; font-size: 20px; }" });
  await sleep(3200);
  // ロゴと文字に重なっている背景のカードを、左右へよける
  await page.evaluate(() => {
    for (const [i, a] of window.__flip.ambient.entries()) {
      const p = a.group.position;
      if (Math.abs(p.x) < 720 && p.y > -300 && p.y < 330) p.x = (i % 2 ? 1 : -1) * (780 + ((i * 97) % 160));
    }
  });
  await sleep(120);
});

// 2. 対戦中（LETHAL と MATCH POINT）
await shot("02-battle", async (page) => {
  await startCpuGame(page);
  await waitMyTurn(page);
  await richBoard(page);
  await page.evaluate(() => document.querySelector(".row.me .main-slot .card")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  await caption(page, "26 文字 × 28 記号の<br>対戦カードゲーム", "ALPHABET BATTLE CARDS", "top");
  await sleep(900);
});

// 3. 進化の瞬間
await shot("03-evolve", async (page) => {
  await startCpuGame(page);
  await waitMyTurn(page);
  await richBoard(page, { lethal: false, myKos: 1, oppKos: 1, evolved: false });
  await page.evaluate(() => {
    const a = window.__promo.unit(0, "A");
    a.unit.tenure = 2; // このターンの終わりで 3 ターン目 → 進化
    window.__promo.render();
  });
  await caption(page, "小文字から大文字へ<br>ユニットが進化する", "EVOLVE", "top");
  await clickEl(page, "[data-end]", { cursor: false });
  await page.mouse.move(1900, 1070);
  await page.evaluate(() => document.querySelector(".row.me .main-slot .card")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  await waitFor(page, () => !!document.querySelector(".banner.evolve"));
  await sleep(780);
});

// 4. トロフィーカードのコレクション
const got = [
  "first-game", "tutorial", "first-win", "hotseat", "wildcard", "change", "wins-5", "streak-3", "speed", "big-hit",
  "evolve-3", "perfect", "comeback", "symbol-ko", "zorome", "needle-ko", "jackpot-9", "one-shot", "double-ko", "triple-7",
  "all-decks", "wins-20",
];
await shot(
  "04-trophies",
  async (page) => {
    await waitFor(page, () => !!document.querySelector("[data-go=collection]"));
    await sleep(600);
    await clickEl(page, "[data-go=collection]", { cursor: false });
    await waitFor(page, () => !!document.querySelector(".trophy-item") && !document.querySelector(".fx-curtain"));
    await sleep(500);
    await clickEl(page, '.trophy-item[data-t="triple-7"]', { cursor: false });
    await sleep(1300);
    await caption(page, "35 種類のトロフィーカード", "COLLECT TROPHIES", "bottom");
    await sleep(600);
  },
  prefsFor(
    {
      games: 31, wins: 22, losses: 9, streak: 4, bestStreak: 6, kos: 131, evolutions: 58, hotseatGames: 3, tutorialDone: true,
      trophies: Object.fromEntries(got.map((id) => [id, "2026-10-20T12:00:00.000Z"])),
    },
    { cardBack: "jackpot" },
  ),
);

// 5. 撃破（K.O.）
await shot("05-ko", async (page) => {
  await startCpuGame(page);
  await waitMyTurn(page);
  await richBoard(page, { myKos: 3, oppKos: 2 });
  await page.evaluate(() => {
    window.__promo.find(1, (c) => c.kind === "unit" && c.letter === "Z").unit.hp = 3;
    window.__promo.render();
  });
  await caption(page, "5 回撃破したら勝ち", "KNOCK OUT", "top");
  await clickEl(page, "[data-end]", { cursor: false });
  await page.mouse.move(1900, 1070);
  await page.evaluate(() => document.querySelector(".row.me .main-slot .card")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  await waitFor(page, () => !!document.querySelector(".banner.ko"));
  await sleep(800);
});
