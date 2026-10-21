// ダイアログ（技・記号の確認と対象選択、撃破後のメイン選択、準備、交代画面、決着）。
import theme from "../../data/theme.json" with { type: "json" };
import text from "../../data/text.json" with { type: "json" };
import { SYMBOLS, UNITS } from "../../engine/data.ts";
import { requestsForSkill, requestsForSymbol } from "../../engine/game.ts";
import { autoPay, changeCard, isValidPayment, mainCandidates, paymentValue, skillCost, skillForm, unitCard } from "../../engine/query.ts";
import type { Action, ChoiceRequest, Choices, GameState, PlayerId } from "../../engine/types.ts";
import { artToHtml, bannerArt, cardArt } from "../ascii.ts";
import { esc, fmt } from "../text.ts";

const D = text.dialog;

export interface Modal {
  el: HTMLElement;
  close: () => void;
}

export function openModal(host: HTMLElement, cls = "", opaque = false): Modal {
  const back = document.createElement("div");
  back.className = `modal-back${opaque ? " opaque" : ""}`;
  const el = document.createElement("div");
  el.className = `modal ${cls}`;
  back.appendChild(el);
  host.appendChild(back);
  return { el, close: () => back.remove() };
}

function miniCard(s: GameState, id: number, size: string, extra = ""): string {
  const c = s.cards[id];
  const loc = c.kind === "unit" ? { state: s } : {};
  return `<pre class="card s-${size} pick" data-id="${id}" ${extra}>${artToHtml(cardArt(c, loc))}</pre>`;
}

/** 選択肢のカード一覧。count 枚ちょうど選ぶ */
function pickerHtml(s: GameState, req: ChoiceRequest, picked: number[], label?: string): string {
  const head = label ?? (D.src as Record<string, string>)[req.src];
  if (req.count === 0) return `<div class="picker"><div class="picker-head">${head}</div><p class="dim">${D.noTarget}</p></div>`;
  const cards = req.options
    .map((id) => miniCard(s, id, "dlg", `data-key="${req.key}"`).replace('class="card', `class="card${picked.includes(id) ? " selected" : ""}`))
    .join("");
  return `<div class="picker"><div class="picker-head">${head} <span class="dim">${fmt(D.pick, { n: req.count })}（${picked.length}/${req.count}）</span></div><div class="picker-cards">${cards}</div></div>`;
}

function toggle(list: number[], id: number, max: number): number[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  if (max === 1) return [id];
  return list.length < max ? [...list, id] : list;
}

function autoFill(reqs: ChoiceRequest[], picks: Choices): Choices {
  const out: Choices = {};
  for (const r of reqs) {
    const prev = (picks[r.key] ?? []).filter((id) => r.options.includes(id)).slice(0, r.count);
    out[r.key] = prev.length === 0 && r.options.length === r.count ? [...r.options] : prev;
  }
  return out;
}

const complete = (reqs: ChoiceRequest[], picks: Choices) => reqs.every((r) => (picks[r.key] ?? []).length === r.count);

function reqLabel(r: ChoiceRequest): string | undefined {
  if (r.op === "swapHandSub") return r.key.endsWith("h") ? D.swapHandSubHand : D.swapHandSubSub;
  return undefined;
}

/** 技の発動（支払いと対象の選択）。キャンセルなら null */
export function skillDialog(host: HTMLElement, s: GameState, p: PlayerId, unitId: number): Promise<Action | null> {
  const u = unitCard(s, unitId)!;
  const def = UNITS[u.letter];
  const form = skillForm(u);
  const cost = skillCost(s, p, unitId);
  let payment = autoPay(s, p, cost) ?? [];
  let picks: Choices = {};
  const m = openModal(host, "skill-dlg");
  const [c1] = (theme.attr as Record<string, string[]>)[def.attr];
  return new Promise((resolve) => {
    const render = () => {
      const reqs = requestsForSkill(s, p, unitId, payment);
      picks = autoFill(reqs, picks);
      const valid = isValidPayment(s, p, payment, cost);
      const sum = payment.reduce((a, id) => a + paymentValue(s, id), 0);
      const hasZero = payment.some((id) => (s.cards[id] as { value?: number }).value === 0);
      const kept = valid ? changeCard(s, payment, cost) : null;
      const payInfo = cost <= 0 ? D.payFree : hasZero && valid ? D.payZero
        : kept ? fmt(D.payChange, { sum, cost, left: kept.left, card: (s.cards[kept.id] as { value: number }).value })
        : fmt(D.paySum, { sum, cost });
      const storage = s.players[p].storage
        .map((id) => miniCard(s, id, "dlg", 'data-pay="1"').replace('class="card', `class="card${payment.includes(id) ? " selected" : ""}`))
        .join("");
      m.el.innerHTML = `
        <div class="dlg-head"><span class="ttl" style="color:${c1}">${def.skill.name}</span>
          <span class="dim">${esc(u.unit.evolved ? u.letter : u.letter.toLowerCase())}・${text.detail.cost} ${cost}</span></div>
        <p class="dlg-text">${form.text}</p>
        ${cost > 0 ? `<div class="picker"><div class="picker-head">${D.payment} <span class="${valid ? "ok" : "bad"}">${payInfo}</span></div>
          <div class="picker-cards">${storage}</div>${valid ? "" : `<p class="bad small">${D.payBad}</p>`}</div>` : `<p class="dim">${D.payFree}</p>`}
        ${reqs.map((r) => pickerHtml(s, r, picks[r.key] ?? [], reqLabel(r))).join("")}
        <div class="dlg-buttons"><button class="btn hot" data-go ${valid && complete(reqs, picks) ? "" : "disabled"}>[ ${D.activate} ]</button>
          <button class="btn" data-cancel>[ ${D.cancel} ]</button></div>`;
    };
    render();
    m.el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const card = t.closest<HTMLElement>(".pick");
      if (card) {
        const id = Number(card.dataset.id);
        if (card.dataset.pay) payment = payment.includes(id) ? payment.filter((x) => x !== id) : [...payment, id];
        else {
          const key = card.dataset.key!;
          const req = requestsForSkill(s, p, unitId, payment).find((r) => r.key === key)!;
          picks[key] = toggle(picks[key] ?? [], id, req.count);
        }
        render();
        return;
      }
      if (t.closest("[data-go]")) {
        m.close();
        resolve({ type: "useSkill", player: p, unit: unitId, payment, choices: picks });
      } else if (t.closest("[data-cancel]")) {
        m.close();
        resolve(null);
      }
    });
  });
}

export function symbolDialog(host: HTMLElement, s: GameState, p: PlayerId, cardId: number): Promise<Action | null> {
  const c = s.cards[cardId];
  if (c.kind !== "sym") return Promise.resolve(null);
  const def = SYMBOLS[c.sym];
  const reqs = requestsForSymbol(s, p, cardId);
  let picks: Choices = autoFill(reqs, {});
  const m = openModal(host, "symbol-dlg");
  return new Promise((resolve) => {
    const render = () => {
      m.el.innerHTML = `
        <div class="dlg-head"><span class="ttl" style="color:${theme.sym[0]}">${esc(def.label)}　${def.name}</span></div>
        <p class="dlg-text">${def.text}</p>
        ${reqs.map((r) => pickerHtml(s, r, picks[r.key] ?? [], reqLabel(r))).join("")}
        <div class="dlg-buttons"><button class="btn hot" data-go ${complete(reqs, picks) ? "" : "disabled"}>[ ${D.use} ]</button>
          <button class="btn" data-cancel>[ ${D.cancel} ]</button></div>`;
    };
    render();
    m.el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const card = t.closest<HTMLElement>(".pick");
      if (card) {
        const key = card.dataset.key!;
        const req = reqs.find((r) => r.key === key)!;
        picks[key] = toggle(picks[key] ?? [], Number(card.dataset.id), req.count);
        render();
        return;
      }
      if (t.closest("[data-go]")) {
        m.close();
        resolve({ type: "useSymbol", player: p, card: cardId, choices: picks });
      } else if (t.closest("[data-cancel]")) {
        m.close();
        resolve(null);
      }
    });
  });
}

export function chooseMainDialog(host: HTMLElement, s: GameState, p: PlayerId): Promise<Action> {
  const ids = mainCandidates(s, p);
  const m = openModal(host, "choose-dlg");
  m.el.innerHTML = `<div class="dlg-head"><span class="ttl" style="color:${theme.danger}">K.O.</span></div>
    <p class="dlg-text">${D.chooseMain}</p>
    <div class="picker-cards big">${ids.map((id) => miniCard(s, id, "pool")).join("")}</div>`;
  return new Promise((resolve) => {
    m.el.addEventListener("click", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".pick");
      if (!card) return;
      m.close();
      resolve({ type: "chooseMain", player: p, card: Number(card.dataset.id) });
    });
  });
}

export function listDialog(host: HTMLElement, s: GameState, title: string, ids: number[]): void {
  const m = openModal(host, "list-dlg");
  m.el.innerHTML = `<div class="dlg-head"><span class="ttl">${title}</span></div>
    <div class="picker-cards wrap">${ids.map((id) => miniCard(s, id, "dlg")).join("") || `<p class="dim">—</p>`}</div>
    <div class="dlg-buttons"><button class="btn" data-cancel>[ ${D.close} ]</button></div>`;
  m.el.querySelector("[data-cancel]")!.addEventListener("click", () => m.close());
}

/** 準備: プールの 7 枚からメインとサブを選ぶ */
export function setupDialog(
  host: HTMLElement,
  s: GameState,
  p: PlayerId,
  who: string,
  validate?: (main: number | null, subs: number[]) => string | null,
): Promise<Action> {
  const S = text.setup;
  const pool = s.players[p].pool;
  const role = new Map<number, "main" | "sub">();
  const m = openModal(host, "setup-dlg");
  m.el.dataset.tut = "setup";
  return new Promise((resolve) => {
    const render = (msg = "") => {
      const cards = pool
        .map((id) => {
          const r = role.get(id);
          const tag = r === "main" ? `<span class="role main">${S.main}</span>` : r === "sub" ? `<span class="role sub">${S.sub}</span>` : `<span class="role"> </span>`;
          return `<div class="pool-item ${r ?? ""}">${tag}${miniCard(s, id, "pool")}</div>`;
        })
        .join("");
      m.el.innerHTML = `<div class="dlg-head"><span class="ttl">${S.title}</span><span class="dim">${esc(who)}</span></div>
        <p class="dlg-text">${S.help}</p><div class="pool">${cards}</div>
        <p class="bad small msg">${msg}</p><p class="dim small">${S.hidden}</p>
        <div class="dlg-buttons"><button class="btn hot" data-go>[ ${S.ok} ]</button></div>`;
    };
    render();
    m.el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const item = t.closest<HTMLElement>(".pool-item");
      if (item) {
        const id = Number(item.querySelector<HTMLElement>(".pick")!.dataset.id);
        const r = role.get(id);
        if (!r) {
          // MAIN が空いていればまず MAIN、埋まっていれば SUB
          if (![...role.values()].includes("main")) role.set(id, "main");
          else role.set(id, "sub");
        } else if (r === "main") role.set(id, "sub");
        else role.delete(id);
        render();
        return;
      }
      if (t.closest("[data-go]")) {
        const main = [...role].find(([, r]) => r === "main")?.[0] ?? null;
        const subs = [...role].filter(([, r]) => r === "sub").map(([id]) => id);
        const err = main === null ? S.needMain : subs.length > s.rules.subSlots ? S.tooMany : validate?.(main, subs) ?? null;
        if (err) return render(err);
        m.close();
        resolve({ type: "setup", player: p, main: main!, subs });
      }
    });
  });
}

export function passScreen(host: HTMLElement, who: string, prev: string): Promise<void> {
  const P = text.pass;
  const m = openModal(host, "pass-dlg", true);
  m.el.innerHTML = `<pre class="banner-art">${artToHtml(bannerArt(who.replace(/[^A-Z0-9]/gi, "").slice(0, 2) || "?", [[theme.accent, theme.accent2]]))}</pre>
    <h2>${fmt(P.title, { who: esc(who) })}</h2><p>${fmt(P.body, { prev: esc(prev) })}</p>
    <div class="dlg-buttons"><button class="btn hot" data-go>[ ${fmt(P.ok, { who: esc(who) })} ]</button></div>`;
  return new Promise((resolve) => {
    m.el.querySelector("[data-go]")!.addEventListener("click", () => {
      m.close();
      resolve();
    });
  });
}

export function gameOverScreen(host: HTMLElement, title: string, sub: string, win: boolean, onShare?: () => void): Promise<"again" | "title"> {
  const O = text.over;
  const m = openModal(host, "over-dlg");
  const colors: [string, string][] = win
    ? [[theme.accent, theme.attr.Curved[1]], [theme.gold, theme.attr.Mixed[1]]]
    : [[theme.danger, theme.attr.Diagonal[1]], [theme.dim, theme.faint]];
  m.el.innerHTML = `<pre class="banner-art">${artToHtml(bannerArt(title, colors))}</pre>
    <p class="dlg-text center">${sub}</p>
    <div class="dlg-buttons center"><button class="btn hot" data-again>[ ${O.again} ]</button><button class="btn" data-title>[ ${O.title} ]</button>${onShare ? `<button class="btn share" data-share>[ ${text.share.button} ]</button>` : ""}</div>`;
  return new Promise((resolve) => {
    m.el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-again]")) {
        m.close();
        resolve("again");
      } else if (t.closest("[data-title]")) {
        m.close();
        resolve("title");
      } else if (t.closest("[data-share]")) {
        onShare?.();
      }
    });
  });
}

export function confirmDialog(host: HTMLElement, msg: string): Promise<boolean> {
  const m = openModal(host, "confirm-dlg");
  m.el.innerHTML = `<p class="dlg-text">${msg}</p><div class="dlg-buttons"><button class="btn hot" data-go>[ ${D.ok} ]</button><button class="btn" data-cancel>[ ${D.cancel} ]</button></div>`;
  return new Promise((resolve) => {
    m.el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-go]")) {
        m.close();
        resolve(true);
      } else if (t.closest("[data-cancel]")) {
        m.close();
        resolve(false);
      }
    });
  });
}
