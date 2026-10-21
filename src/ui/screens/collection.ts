// トロフィーカードの獲得演出と、コレクション画面（集めたカード・記録・裏面の切り替え）。
import text from "../../data/text.json" with { type: "json" };
import theme from "../../data/theme.json" with { type: "json" };
import trophiesJson from "../../data/trophies.json" with { type: "json" };
import { artToHtml, BACKS, backArt, rankColors, setBackDesign, trophyArt, type TrophyDef } from "../ascii.ts";
import { playBgm, playSe } from "../audio.ts";
import { cover, flash, sparks, uncover } from "../fx.ts";
import { flipInPlace, rectOf } from "../flip3d.ts";
import { openModal } from "../game/dialogs.ts";
import { prefs, savePrefs } from "../prefs.ts";
import { esc, fmt } from "../text.ts";
import { hasTrophy, TROPHIES, trophyCount, unlockedBacks } from "../trophies.ts";

const C = text.collection;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function rankLabel(rank: string): string {
  return (trophiesJson.ranks as Record<string, { label: string }>)[rank]?.label ?? rank;
}

/** 手に入れたトロフィーを 1 枚ずつ見せる */
export async function revealTrophies(host: HTMLElement, list: TrophyDef[]): Promise<void> {
  for (const t of list) {
    const m = openModal(host, "trophy-dlg");
    const [c1, c2] = rankColors(t.rank);
    const backName = t.back ? BACKS[t.back]?.name : "";
    m.el.innerHTML = `<div class="trophy-head" style="color:${c1};visibility:hidden">TROPHY GET!</div>
      <pre class="card s-trophy roulette">${artToHtml(backArt())}</pre>
      <h2 style="color:${c1}">${esc(t.name)} <span class="dim">${rankLabel(t.rank)}</span></h2>
      <p>${esc(t.desc)}</p>
      ${backName ? `<p class="ok">${fmt(C.backUnlocked, { name: esc(backName) })}</p>` : ""}
      <div class="dlg-buttons center"><button class="btn hot" data-go disabled>[ ${C.next} ]</button></div>`;
    await nextFrame();
    const el = m.el.querySelector<HTMLElement>(".card")!;
    // スロットのように、いろいろなトロフィーが高速で入れ替わり、だんだん遅くなって止まる
    const pool = TROPHIES.filter((x) => x.id !== t.id);
    for (let delay = 45; delay < 300; delay *= 1.13) {
      const r = pool[Math.floor(Math.random() * pool.length)];
      el.innerHTML = artToHtml(Math.random() < 0.3 ? backArt() : trophyArt(r, Math.random() < 0.4));
      playSe("roulette", 0.5);
      await new Promise((res) => setTimeout(res, delay));
    }
    el.classList.remove("roulette");
    el.classList.add("holo");
    el.innerHTML = artToHtml(trophyArt(t));
    el.style.visibility = "hidden";
    const to = rectOf(el);
    playSe("trophy");
    await flipInPlace(to, backArt(), trophyArt(t), { flips: 3, duration: 900, lift: 240 });
    el.style.visibility = "";
    m.el.querySelector<HTMLElement>(".trophy-head")!.style.visibility = "";
    flash(c1, 0.55, 800);
    sparks({ x: to.x + to.w / 2, y: to.y + to.h / 2 }, [c1, c2, theme.fg], 60, 2);
    const btn = m.el.querySelector<HTMLButtonElement>("[data-go]")!;
    btn.disabled = false;
    btn.focus();
    await new Promise<void>((r) => btn.addEventListener("click", () => r(), { once: true }));
    m.close();
  }
}

export function showCollection(stage: HTMLElement): Promise<void> {
  const root = document.createElement("div");
  root.className = "screen collection";
  stage.appendChild(root);
  playBgm("collection");
  let selected: string | null = null;
  const render = () => {
    const P = prefs.progress;
    const { got, total } = trophyCount();
    const cards = TROPHIES.map((t) => {
      const own = hasTrophy(t.id);
      return `<div class="trophy-item ${own ? "own" : "locked"} ${selected === t.id ? "sel" : ""}" data-t="${t.id}">
        <pre class="card s-coll ${own ? "holo" : ""}">${artToHtml(trophyArt(t, !own))}</pre>
        <div class="trophy-name">${own ? esc(t.name) : "？？？"}</div></div>`;
    }).join("");
    const sel = TROPHIES.find((t) => t.id === selected);
    const detail = sel
      ? (() => {
          const own = hasTrophy(sel.id);
          const [c1] = rankColors(sel.rank);
          const date = own ? new Date(prefs.progress.trophies[sel.id]).toLocaleDateString("ja-JP") : "";
          return `<h3 style="color:${own ? c1 : theme.dim}">${own ? esc(sel.name) : "？？？"} <span class="dim">${rankLabel(sel.rank)}</span></h3>
            <p>${esc(sel.desc)}</p>
            ${own ? `<p class="dim">${fmt(C.gotOn, { date })}</p>` : `<p class="dim">${C.locked}</p>`}
            ${sel.back ? `<p>${fmt(C.backReward, { name: esc(BACKS[sel.back]?.name ?? "") })}</p>` : ""}`;
        })()
      : `<p class="dim">${C.pick}</p>`;
    const backs = Object.keys(BACKS)
      .map((id) => {
        const ok = unlockedBacks().includes(id);
        const on = prefs.cardBack === id;
        return `<div class="back-item ${ok ? "" : "locked"} ${on ? "on" : ""}" data-back="${id}">
          <pre class="card s-mini">${artToHtml(backArt(id))}</pre><span>${on ? "▶ " : ""}${esc(BACKS[id].name)}</span></div>`;
      })
      .join("");
    root.innerHTML = `
      <div class="col-left">
        <h2>┤ ${C.title} ├ <span class="dim">${got}/${total}</span></h2>
        <div class="trophy-grid">${cards}</div>
        <h2>┤ ${C.backs} ├ <span class="dim">${C.backsHelp}</span></h2>
        <div class="back-grid">${backs}</div>
      </div>
      <div class="col-right panel"><div class="ttl">${C.detail}</div>
        <div class="detail-body">${detail}</div>
        <div class="stats">
          <h3>${C.stats}</h3>
          <p>${fmt(C.record, { g: P.games, w: P.wins, l: P.losses })}</p>
          <p>${fmt(C.streak, { s: P.streak, b: P.bestStreak })}</p>
          <p>${fmt(C.kos, { k: P.kos, e: P.evolutions })}</p>
          <p>${fmt(C.hotseat, { h: P.hotseatGames })}</p>
        </div>
        <div class="dlg-buttons"><button class="btn" data-back-title>[ ${C.back} ]</button></div>
      </div>`;
  };
  render();
  return new Promise((resolve) => {
    root.addEventListener("click", async (e) => {
      const t = e.target as HTMLElement;
      const item = t.closest<HTMLElement>(".trophy-item");
      if (item) {
        selected = item.dataset.t!;
        render();
        const tr = TROPHIES.find((x) => x.id === selected)!;
        if (hasTrophy(tr.id)) {
          const el = root.querySelector<HTMLElement>(`.trophy-item[data-t="${tr.id}"] .card`)!;
          el.style.visibility = "hidden";
          playSe("flip");
          await flipInPlace(rectOf(el), backArt(), trophyArt(tr), { flips: 3, duration: 900, lift: 220 });
          el.style.visibility = "";
          const r = rectOf(el);
          sparks({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, [...rankColors(tr.rank), theme.fg], 24, 1);
        }
        return;
      }
      const back = t.closest<HTMLElement>(".back-item");
      if (back && !back.classList.contains("locked")) {
        prefs.cardBack = back.dataset.back!;
        setBackDesign(prefs.cardBack);
        savePrefs();
        render();
        return;
      }
      if (t.closest("[data-back-title]")) {
        await cover();
        root.remove();
        resolve();
      }
    });
  });
}

