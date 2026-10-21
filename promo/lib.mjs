// サムネイルと紹介動画の撮影に使う共通の道具。
// 開発サーバ（abc-play、http://localhost:5210/）の実際のゲーム画面を、ヘッドレスの Chrome で 1920×1080 で開いて操作する。
import puppeteer from "puppeteer-core";

export const BASE = process.env.ABC_URL ?? "http://localhost:5210/";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ブラウザに残す設定（音なし・演出はふつうの速さ）。progress を渡すとトロフィーの記録を入れた状態で始める */
export function prefsFor(progress = {}, extra = {}) {
  return {
    speed: 1,
    sound: false,
    decks: [],
    lastDeck: "preset:starter",
    lastDeck2: "preset:diagonal",
    cardBack: "",
    progress: {
      games: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0, kos: 0, evolutions: 0, hotseatGames: 0,
      tutorialDone: false, deckWins: {}, trophies: {}, lettersUsed: [], symbolsUsed: [],
      ...progress,
    },
    ...extra,
  };
}

export async function launch(prefs = prefsFor()) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--window-size=1920,1080", "--hide-scrollbars", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((p) => {
    localStorage.setItem("abc.prefs.v1", JSON.stringify(p));
  }, prefs);
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await installHelpers(page);
  return { browser, page };
}

/** ページの中で使う小さな道具（カードを好きな場所に置く、など）と、撮影用の見た目 */
export async function installHelpers(page) {
  await page.addStyleTag({
    content: `
    .promo-cap { position: fixed; z-index: 95; pointer-events: none; font-family: var(--mono);
      background: rgba(6, 6, 10, 0.94); border: 1px solid var(--accent); padding: 22px 36px 20px;
      box-shadow: 0 0 0 6px rgba(6, 6, 10, 0.94), 0 0 0 7px #2c2c40, 0 0 60px -10px var(--accent); }
    .promo-cap.bottom { left: 40px; bottom: 40px; }
    .promo-cap.top { left: 30px; top: 70px; }
    .promo-cap .ja { font-size: 52px; font-weight: 700; color: #fff; letter-spacing: 2px; line-height: 1.3; }
    .promo-cap .en { font-size: 20px; letter-spacing: 10px; color: var(--accent); margin-top: 8px; }
    .promo-cap.show { animation: promoCap 0.5s cubic-bezier(.2,.8,.2,1) both; }
    @keyframes promoCap { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: none; } }
    .promo-cursor { position: fixed; z-index: 99; width: 26px; height: 26px; pointer-events: none; left: 0; top: 0;
      transition: transform 0.45s cubic-bezier(.4,0,.2,1); }
    .promo-cursor svg { filter: drop-shadow(0 2px 4px rgba(0,0,0,.8)); }
    .promo-cursor.click::after { content: ""; position: absolute; left: -16px; top: -16px; width: 32px; height: 32px; border: 3px solid #00f0c8;
      border-radius: 50%; animation: promoClick 0.4s ease-out forwards; }
    @keyframes promoClick { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
    `,
  });
  await page.evaluate(() => {
    const P = (window.__promo = {});
    const S = () => window.__abc;
    P.find = (owner, pred) => Object.values(S().s.cards).find((c) => c.owner === owner && pred(c));
    P.num = (owner, v, skip = []) => P.find(owner, (c) => c.kind === "num" && c.value === v && !skip.includes(c.id));
    P.sym = (owner, k) => P.find(owner, (c) => c.kind === "sym" && c.sym === k);
    P.unit = (owner, l) => P.find(owner, (c) => c.kind === "unit" && c.letter === l);
    /** カードを今の場所から抜いて、zone（hand / storage / trash / deck / sub / main）に置く */
    P.move = (card, zone) => {
      const s = S().s;
      for (const pl of s.players) {
        for (const z of ["deck", "hand", "trash", "storage", "subs", "pool"]) {
          const i = pl[z].indexOf(card.id);
          if (i >= 0) pl[z].splice(i, 1);
        }
        if (pl.main === card.id) pl.main = null;
      }
      const pl = s.players[card.owner];
      if (zone === "main") pl.main = card.id;
      else if (zone === "sub") pl.subs.push(card.id);
      else pl[zone].push(card.id);
    };
    P.render = () => S().render(S().s);
    P.myTurn = () => S().s.phase === "main" && S().s.current === 0 && !!S().resolveInput && !S().busy;
  });
}

export async function waitFor(page, fn, timeout = 30000, arg) {
  await page.waitForFunction(fn, { timeout, polling: 50 }, arg);
}

export async function caption(page, ja, en = "", pos = "bottom") {
  await page.evaluate(
    (ja, en, pos) => {
      document.querySelectorAll(".promo-cap").forEach((e) => e.remove());
      const el = document.createElement("div");
      el.className = `promo-cap ${pos} show`;
      el.innerHTML = `<div class="ja">${ja}</div>${en ? `<div class="en">${en}</div>` : ""}`;
      document.body.appendChild(el);
    },
    ja,
    en,
    pos,
  );
}

export async function clearCaption(page) {
  await page.evaluate(() => {
    document.querySelectorAll(".promo-cap").forEach((el) => {
      const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
      a.onfinish = () => el.remove();
    });
  });
}

/** 撮影用の矢印カーソル（ヘッドレスの画面には本物のカーソルが映らないため） */
export async function showCursor(page, x = 960, y = 700) {
  await page.evaluate(
    (x, y) => {
      let c = document.querySelector(".promo-cursor");
      if (!c) {
        c = document.createElement("div");
        c.className = "promo-cursor";
        c.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2 L3 20 L8 15 L11.5 22 L14.5 20.6 L11 13.8 L18 13.8 Z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
        document.body.appendChild(c);
      }
      c.style.transform = `translate(${x}px, ${y}px)`;
    },
    x,
    y,
  );
}

export async function hideCursor(page) {
  await page.evaluate(() => document.querySelector(".promo-cursor")?.remove());
}

/** カーソルを要素まで動かしてからクリックする */
export async function clickEl(page, selector, { moveMs = 550, cursor = true } = {}) {
  const box = await page.evaluate((sel) => {
    const el = typeof sel === "string" ? document.querySelector(sel) : null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  if (!box) throw new Error(`not found: ${selector}`);
  if (cursor) {
    await showCursor(page, box.x, box.y);
    await sleep(moveMs);
    await page.evaluate(() => {
      const c = document.querySelector(".promo-cursor");
      c?.classList.remove("click");
      void c?.offsetWidth;
      c?.classList.add("click");
    });
  }
  await page.mouse.move(box.x, box.y);
  await page.mouse.click(box.x, box.y);
}

/** CPU 戦を始めて、準備（メイン 1・サブ 2）まで進める。first を渡すと先攻を固定する */
export async function startCpuGame(page, { cpuDeck = "preset:diagonal", first = 0, cursor = false, slow = false } = {}) {
  await waitFor(page, () => !!document.querySelector("[data-go=cpu]"));
  await sleep(slow ? 1200 : 300);
  await clickEl(page, "[data-go=cpu]", { cursor });
  await sleep(slow ? 700 : 200);
  await page.select('[data-sel="cpu"]', cpuDeck);
  await clickEl(page, "[data-start=cpu]", { cursor });
  await waitFor(page, () => !!document.querySelector(".pool-item") && !document.querySelector(".fx-curtain"));
  await page.evaluate((first) => {
    window.__abc.s.setupOpts = { ...(window.__abc.s.setupOpts ?? {}), first };
  }, first);
  await sleep(slow ? 900 : 200);
  for (const i of [0, 5, 6]) {
    await clickEl(page, `.pool-item:nth-child(${i + 1})`, { cursor, moveMs: slow ? 420 : 0 });
    await sleep(slow ? 350 : 50);
  }
  await sleep(slow ? 500 : 0);
  await clickEl(page, ".setup-dlg [data-go]", { cursor });
}

export async function waitMyTurn(page, timeout = 60000) {
  await waitFor(page, () => window.__promo.myTurn(), timeout);
}

export async function screenshot(page, path) {
  await page.screenshot({ path, type: "png", captureBeyondViewport: false });
}
