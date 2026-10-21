// 作品紹介動画（1920×1080・30fps・H.264）を、実際のゲームを自動で遊ぶ様子から撮る。
// 画面の更新を時刻つきのコマ（JPEG）で受け取り、ffmpeg で一定のコマ数の MP4 にする。
// 先に abc-play（開発サーバ）を動かしておく。  使い方: npm run video
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BASE, caption, clearCaption, clickEl, hideCursor, installHelpers, launch, prefsFor, showCursor, sleep, waitFor,
} from "./lib.mjs";

const OUT = fileURLToPath(new URL("./out/", import.meta.url));
const FRAMES = `${OUT}frames/`;
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const { browser, page } = await launch(prefsFor());

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

// ---- 撮影 ----
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await startRec();
await installHelpers(page);
await waitFor(page, () => !!document.querySelector(".logo-art"));

// A. タイトル
await sleep(3200);
await showCursor(page, 1500, 900);
await sleep(300);
await clickEl(page, ".logo-art");
await sleep(1300);
const pt = await floatingCardPoint();
if (pt) await clickAt(pt.x, pt.y);
await sleep(1400);
await page.keyboard.type("abc", { delay: 120 });
await sleep(1800);

// B. 対戦の開始
await caption(page, "26 文字のアルファベットで戦う<br>2 人用カードゲーム", "ALPHABET BATTLE CARDS");
await sleep(1200);
await clickEl(page, "[data-go=cpu]");
await sleep(900);
await page.select('[data-sel="cpu"]', "preset:diagonal");
await clickEl(page, "[data-start=cpu]");
await clearCaption(page);
await waitFor(page, () => !!document.querySelector(".pool-item") && !document.querySelector(".fx-curtain"));
await page.evaluate(() => (window.__abc.s.setupOpts = { ...(window.__abc.s.setupOpts ?? {}), first: 0 }));
await caption(page, "メインとサブを選んで<br>同時に公開", "SETUP", "top");
await sleep(1200);
for (const i of [0, 5, 6]) {
  await clickEl(page, `.pool-item:nth-child(${i + 1})`, { moveMs: 450 });
  await sleep(380);
}
await sleep(500);
await clickEl(page, ".setup-dlg [data-go]");
await clearCaption(page);
await hideCursor(page);
await untilMyTurn();
await sleep(600);

// C. 基本の流れ
await stageHand({ nums: [9, 2], syms: ["%"] });
await caption(page, "数字カードはエネルギー", "ENERGY", "top");
await sleep(900);
await clickEl(page, '.hand.me [data-tut="card-n9"]');
await sleep(1500);
await caption(page, "技の支払いは<br>お釣りあり", "PAY & KEEP THE CHANGE", "top");
await sleep(700);
await clickEl(page, ".row.me .main-slot .card");
await sleep(1500);
await clickEl(page, ".skill-dlg [data-go]");
await sleep(2600);
await caption(page, "記号カードは<br>無料の特殊効果", "SYMBOLS", "top");
await sleep(700);
await clickEl(page, '.hand.me [data-tut="card-s%"]');
await sleep(1300);
await clickEl(page, ".symbol-dlg [data-go]");
await sleep(2400);
await caption(page, "ターンの終わりに<br>自動ダメージ", "AUTO DAMAGE", "top");
await sleep(700);
await clickEl(page, "[data-end]");
await hideCursor(page);
await sleep(2600);
await clearCaption(page);
await untilMyTurn();
await sleep(500);

// D. 進化
await page.evaluate(() => {
  const a = window.__promo.unit(0, "A");
  a.unit.tenure = Math.max(a.unit.tenure, 2);
  window.__promo.render();
});
await caption(page, "在籍ターンがたまると<br>小文字 → 大文字に進化", "EVOLVE", "top");
await sleep(1600);
await clickEl(page, "[data-end]");
await hideCursor(page);
await waitFor(page, () => !!document.querySelector(".banner.evolve"));
await sleep(2200);
await clearCaption(page);
await untilMyTurn();
await sleep(500);

// E. LETHAL → K.O. → MATCH POINT
await page.evaluate(() => {
  const s = window.__abc.s;
  s.players[0].kos = 3;
  const mine = s.cards[s.players[0].main];
  mine.unit.hp = mine.unit.maxHp; // 撮影の途中で自分が倒されないように
  const m = s.cards[s.players[1].main];
  m.unit.hp = Math.min(m.unit.hp, 6);
  window.__promo.render();
});
await caption(page, "倒せる見込みになると<br>LETHAL", "LETHAL", "top");
await sleep(2600);
await clickEl(page, "[data-end]");
await hideCursor(page);
await clearCaption(page);
await waitFor(page, () => !!document.querySelector(".banner.match"), 20000);
await sleep(1800);
await untilMyTurn();
await sleep(400);

// F. 勝利とトロフィー
await page.evaluate(() => {
  const s = window.__abc.s;
  const m = s.cards[s.players[1].main];
  m.unit.hp = Math.min(m.unit.hp, 6);
  window.__promo.render();
});
await caption(page, "5 回撃破で勝利", "VICTORY", "top");
await sleep(1800);
await clickEl(page, "[data-end]");
await hideCursor(page);
await clearCaption(page);
await waitFor(page, () => !!document.querySelector(".trophy-dlg"), 30000);
await caption(page, "35 種類のトロフィーカード", "TROPHY CARDS", "bottom");
let first = true;
for (let n = 0; n < 10; n++) {
  const open = await page.evaluate(() => !!document.querySelector(".trophy-dlg"));
  if (!open) break;
  if (!first) await page.evaluate(() => document.querySelector(".trophy-dlg")?.click()); // 2 枚目からはルーレットを飛ばす
  await waitFor(page, () => !document.querySelector(".trophy-dlg [data-go][disabled]"), 15000);
  await sleep(first ? 1600 : 700);
  first = false;
  await clickEl(page, ".trophy-dlg [data-go]", { moveMs: 300 });
  await sleep(500);
}
await clearCaption(page);
await waitFor(page, () => !!document.querySelector(".over-dlg"));
await sleep(2200);

// G. コレクション
await clickEl(page, ".over-dlg [data-title]");
await waitFor(page, () => !!document.querySelector("[data-go=collection]") && !document.querySelector(".fx-curtain"));
await sleep(1200);
await clickEl(page, "[data-go=collection]");
await waitFor(page, () => !!document.querySelector(".trophy-item") && !document.querySelector(".fx-curtain"));
await caption(page, "集めたトロフィーは<br>コレクションで眺められる", "COLLECTION", "bottom");
await sleep(900);
await clickEl(page, ".trophy-item.own");
await sleep(2400);
await clearCaption(page);
await clickEl(page, "[data-back-title]");
await hideCursor(page);

// H. 締め（タイトル）
await waitFor(page, () => !!document.querySelector(".logo-art") && !document.querySelector(".fx-curtain"));
await page.addStyleTag({ content: ".title .menu, .title .footer, .sound-toggle { opacity: 0; transition: opacity .6s; }" });
await sleep(4200);
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
