// 操作の結果（イベント列）を順に見せる。イベントごとの状態（snap）で盤面を描き直し、
// 場所が変わったカードは Three.js の板で前の位置から次の位置へ飛ばす（見え方が変われば裏返す）。
import theme from "../../data/theme.json" with { type: "json" };
import text from "../../data/text.json" with { type: "json" };
import { UNITS } from "../../engine/data.ts";
import { locate, type Zone } from "../../engine/query.ts";
import type { GameEvent, GameState, PlayerId } from "../../engine/types.ts";
import { artKey, artToHtml, backArt, bannerArt, labelArt } from "../ascii.ts";
import { flipInPlace, fly, rectOf, type Rect } from "../flip3d.ts";
import { fmt } from "../text.ts";
import { playSe } from "../audio.ts";
import { centerOf, flash, FX, hitBlink, lunge, shake as shakeScreen, sparks } from "../fx.ts";
import { visibleArt } from "./view.ts";

export interface AnimHost {
  board: HTMLElement;
  viewer: PlayerId;
  names: [string, string];
  speed: number;
  render: (s: GameState, hidden: Set<number>) => void;
  onEvents: (evs: GameEvent[], s: GameState) => void;
}

const MERGE = new Set(["draw", "reshuffle", "deckEmpty", "effect", "toHand", "trashed"]);

function groupEvents(events: GameEvent[]): GameEvent[][] {
  const out: GameEvent[][] = [];
  for (const ev of events) {
    const last = out[out.length - 1];
    if (last && MERGE.has(ev.t) && last[last.length - 1].t === ev.t) last.push(ev);
    else out.push([ev]);
  }
  return out;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function cardRects(board: HTMLElement): Map<number, Rect> {
  const m = new Map<number, Rect>();
  board.querySelectorAll<HTMLElement>(".card[data-id]").forEach((el) => m.set(Number(el.dataset.id), rectOf(el)));
  return m;
}

function pileRect(board: HTMLElement, p: PlayerId, kind: "deck" | "trash"): Rect | null {
  const el = board.querySelector(`[data-pile="${kind}-${p}"] .card`);
  return el ? rectOf(el) : null;
}

function zoneOf(s: GameState, id: number): { p: PlayerId; zone: Zone } | null {
  const l = locate(s, id);
  return l ? { p: l.p, zone: l.zone } : null;
}

function rectFor(board: HTMLElement, rects: Map<number, Rect>, s: GameState, id: number): Rect | null {
  const r = rects.get(id);
  if (r) return r;
  const z = zoneOf(s, id);
  if (!z) return null;
  if (z.zone === "deck" || z.zone === "trash") return pileRect(board, z.p, z.zone);
  return null;
}

function boardCenter(board: HTMLElement, w = 0.12, h = 0.32): Rect {
  const b = rectOf(board);
  const cw = b.w * w;
  const ch = b.h * h;
  return { x: b.x + b.w / 2 - cw / 2, y: b.y + b.h / 2 - ch / 2, w: cw, h: ch };
}

function unhide(board: HTMLElement, id: number): void {
  board.querySelectorAll<HTMLElement>(`.card[data-id="${id}"]`).forEach((el) => el.classList.remove("anim-hidden"));
}

/** 画面に一瞬出す文字（ダメージの数字など）。fixed なので拡大縮小の影響を受けない */
export function popup(at: Rect, html: string, cls: string, scale: number, speed: number): void {
  const el = document.createElement("div");
  el.className = `popup ${cls}`;
  el.innerHTML = html;
  el.style.left = `${at.x + at.w / 2}px`;
  el.style.top = `${at.y + at.h * 0.35}px`;
  el.style.fontSize = `${Math.max(12, 30 * scale)}px`;
  el.style.animationDuration = `${1100 / speed}ms`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1150 / speed);
}

export function banner(board: HTMLElement, html: string, cls: string, speed: number, ms = 900): Promise<void> {
  const el = document.createElement("div");
  el.className = `banner ${cls}`;
  el.innerHTML = html;
  const b = rectOf(board);
  el.style.left = `${b.x + b.w / 2}px`;
  el.style.top = `${b.y + b.h / 2}px`;
  el.style.setProperty("--s", String(b.w / 1200));
  el.style.animationDuration = `${ms / speed}ms`;
  document.body.appendChild(el);
  return wait(ms / speed).then(() => el.remove());
}

function artBanner(textStr: string, colors: [string, string][]): string {
  return `<pre>${artToHtml(bannerArt(textStr, colors))}</pre>`;
}

function shake(board: HTMLElement, id: number): void {
  const el = board.querySelector<HTMLElement>(`.card[data-id="${id}"]`);
  if (!el) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

export async function animateEvents(host: AnimHost, prev: GameState, events: GameEvent[]): Promise<void> {
  const { board } = host;
  const sp = host.speed;
  if (sp <= 0 || !events.length) {
    if (events.length) host.onEvents(events, events[events.length - 1].snap!);
    return;
  }
  let cur = prev;
  const scale = rectOf(board).w / 1200;
  for (const g of groupEvents(events)) {
    const snap = g[g.length - 1].snap!;
    const before = cardRects(board);
    const beforeDeck = [pileRect(board, 0, "deck"), pileRect(board, 1, "deck")];
    // 場所が変わったカード
    const moved: number[] = [];
    for (const key of Object.keys(snap.cards)) {
      const id = Number(key);
      const a = zoneOf(cur, id);
      const b = zoneOf(snap, id);
      if (!a || !b) continue;
      if (a.zone !== b.zone || a.p !== b.p) moved.push(id);
    }
    const evolveIds = g.filter((e) => e.t === "evolve").map((e) => (e as { id: number }).id);
    const swapIds = g.flatMap((e) => (e.t === "swap" ? [e.a, e.b] : []));
    const keptIds = g.flatMap((e) => (e.t === "pay" && e.kept ? [e.kept.id] : []));
    const hidden = new Set([...moved, ...evolveIds, ...swapIds, ...keptIds]);
    host.render(snap, hidden);
    host.onEvents(g, snap);
    const after = cardRects(board);
    const jobs: Promise<void>[] = [];
    const screen = board.parentElement;
    const at = (id: number) => {
      const r = after.get(id) ?? before.get(id);
      return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
    };
    const cardEl = (id: number) => board.querySelector(`.card[data-id="${id}"]`);
    if (g.some((e) => e.t === "draw")) playSe("draw");
    let k = 0;
    const limit = 14;
    for (const id of moved) {
      const z0 = zoneOf(cur, id)!;
      const to = rectFor(board, after, snap, id);
      let from = rectFor(board, before, cur, id);
      if (z0.zone === "deck" && !from) from = beforeDeck[z0.p];
      const startArt = z0.zone === "pool" ? backArt() : visibleArt(cur, id, host.viewer);
      const endArt = visibleArt(snap, id, host.viewer);
      if (z0.zone === "pool" && to) from = to; // 準備の公開はその場で裏返す
      const poolToDeck = z0.zone === "pool" && zoneOf(snap, id)?.zone === "deck"; // 使わないユニットは見せない
      if (!from || !to || k >= limit || poolToDeck) {
        unhide(board, id);
        continue;
      }
      const toTrash = zoneOf(snap, id)?.zone === "trash";
      const ko = g.some((e) => e.t === "ko" && e.id === id);
      if (k === 0 && artKey(startArt) !== artKey(endArt)) playSe("flip", 0.7);
      jobs.push(
        fly({
          from,
          to,
          startArt,
          endArt,
          flips: artKey(startArt) === artKey(endArt) ? 0 : 1,
          delay: k * (z0.zone === "pool" ? 90 : 110),
          duration: z0.zone === "pool" ? 650 : ko ? 650 : 480,
          lift: z0.zone === "pool" ? 180 : toTrash ? 60 : 110,
          spin: ko ? 1 : 0,
          tint: ko ? 0xff8899 : undefined,
          onLand: () => unhide(board, id),
        }),
      );
      k++;
    }
    for (const id of swapIds) {
      if (moved.includes(id)) continue;
      const from = before.get(id);
      const to = after.get(id);
      if (!from || !to) {
        unhide(board, id);
        continue;
      }
      const art = visibleArt(snap, id, host.viewer);
      jobs.push(fly({ from, to, startArt: art, endArt: art, flips: 0, duration: 520, lift: 140, onLand: () => unhide(board, id) }));
    }
    for (const ev of g) {
      switch (ev.t) {
        case "damage": {
          const r = after.get(ev.id) ?? before.get(ev.id);
          if (ev.amount <= 0) {
            if (r) popup(r, "GUARD", "guard", scale, sp);
            playSe("guard");
            break;
          }
          if (r) popup(r, `-${ev.amount}`, ev.amount >= 25 ? "dmg big" : "dmg", scale * (ev.amount >= 25 ? 1.5 : 1), sp);
          const tier = [...FX.damage].reverse().find((t) => ev.amount >= t.min)!;
          shakeScreen(screen, tier.shake * scale);
          shake(board, ev.id);
          hitBlink(cardEl(ev.id));
          const c = at(ev.id);
          if (c) sparks(c, [theme.danger, theme.gold, theme.fg], tier.sparks, tier.power * scale);
          playSe(ev.amount >= 25 ? "damage-big" : "damage");
          jobs.push(wait(FX.hitStopMs / sp));
          break;
        }
        case "heal": {
          const r = after.get(ev.id) ?? before.get(ev.id);
          if (r) popup(r, `+${ev.amount}`, "heal", scale, sp);
          const c = at(ev.id);
          if (c) sparks(c, [theme.heal, theme.fg], 10, 0.6 * scale);
          playSe("heal");
          break;
        }
        case "auto": {
          const main = snap.players[ev.p].main;
          const r = main !== null ? after.get(main) : null;
          if (r) popup(r, `AUTO ▶ ${ev.amount}`, "auto", scale, sp);
          if (main !== null && ev.amount > 0) {
            lunge(cardEl(main), ev.p === host.viewer ? -1 : 1);
            playSe("attack");
          }
          jobs.push(wait(450 / sp));
          break;
        }
        case "skill": {
          const c = snap.cards[ev.id];
          const r = after.get(ev.id);
          cardEl(ev.id)?.classList.add("pulse");
          if (c.kind === "unit" && r) popup(r, UNITS[c.letter].skill.name.toUpperCase(), "skill", scale, sp);
          lunge(cardEl(ev.id), ev.p === host.viewer ? -0.5 : 0.5);
          flash(theme.accent2, FX.skill.flash, FX.skill.flashMs);
          playSe("skill");
          jobs.push(wait(500 / sp));
          break;
        }
        case "symbol":
          flash(theme.sym[0], FX.symbol.flash, FX.symbol.flashMs);
          playSe("symbol");
          jobs.push(wait(650 / sp));
          break;
        case "place":
          playSe("place");
          break;
        case "effect":
          if (["guard", "half", "reflect", "protectStorage"].includes(ev.kind)) playSe("guard");
          break;
        case "gameOver":
          flash("#ffffff", FX.gameOver.flash, FX.gameOver.flashMs);
          shakeScreen(screen, FX.gameOver.shake * scale);
          break;
        case "pay": {
          playSe("pay");
          // お釣りが残ったカードは、その場で裏返して残りの値を見せる
          const r = ev.kept ? after.get(ev.kept.id) : null;
          if (ev.kept && r) {
            const oldArt = visibleArt(cur, ev.kept.id, host.viewer);
            const newArt = visibleArt(snap, ev.kept.id, host.viewer);
            jobs.push(flipInPlace(r, oldArt, newArt, { duration: 560, lift: 90 }).then(() => unhide(board, ev.kept!.id)));
            popup(r, `-${ev.kept.used}`, "auto", scale * 0.7, sp);
          }
          break;
        }
        case "evolve": {
          const r = after.get(ev.id);
          const oldArt = visibleArt(cur, ev.id, host.viewer);
          const newArt = visibleArt(snap, ev.id, host.viewer);
          if (r) jobs.push(flipInPlace(r, oldArt, newArt, { flips: 3, duration: 1100, lift: 220 }).then(() => unhide(board, ev.id)));
          else unhide(board, ev.id);
          const [c1, c2] = (theme.attr as unknown as Record<string, [string, string]>)[UNITS[(snap.cards[ev.id] as { letter: string }).letter].attr];
          jobs.push(banner(board, artBanner("EVOLVE", [[c1, c2]]), "evolve", sp, 1300));
          flash(c1, FX.evolve.flash, FX.evolve.flashMs);
          const c = at(ev.id);
          if (c) sparks(c, [c1, c2, theme.gold], FX.evolve.sparks, 1.4 * scale);
          playSe("evolve");
          break;
        }
        case "ko": {
          jobs.push(banner(board, artBanner("K.O.", [[theme.danger, theme.accent2]]), "ko", sp, 1100));
          flash("#ffffff", FX.ko.flash, FX.ko.flashMs);
          shakeScreen(screen, FX.ko.shake * scale, 620);
          const r = before.get(ev.id);
          const c = r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : centerOf(board.querySelector(`[data-main="${ev.p}"]`));
          if (c) sparks(c, [theme.fg, theme.danger, theme.gold, theme.accent2], FX.ko.sparks, FX.ko.power * scale);
          playSe("ko");
          break;
        }
        case "turn": {
          const mine = host.names[ev.p];
          const label = host.names[0] === text.names.you ? (ev.p === 0 ? text.banner.yourTurn : text.banner.cpuTurn) : fmt(text.banner.pTurn, { who: mine });
          jobs.push(banner(board, `<div class="turn-banner">${label}<small>TURN ${ev.n}</small></div>`, "turn", sp, 900));
          playSe("turn");
          break;
        }
        case "first": {
          const c = boardCenter(board);
          const names = host.names;
          playSe("coin");
          const art = (p: PlayerId) => labelArt(names[p] === text.names.you ? "1" : names[p] === text.names.cpu ? "C" : String(p + 1), names[p], p === 0 ? theme.accent : theme.accent2);
          await fly({ from: c, to: c, startArt: art((1 - ev.p) as PlayerId), endArt: art(ev.p), flips: 7, duration: 1500, lift: 260 });
          await banner(board, `<div class="turn-banner">${fmt(text.banner.first, { who: names[ev.p] })}</div>`, "turn", sp, 1000);
          break;
        }
      }
    }
    await Promise.all(jobs);
    board.querySelectorAll(".pulse").forEach((el) => el.classList.remove("pulse"));
    if (g.some((e) => e.t === "symbolDone" || e.t === "pay")) await wait(120 / sp);
    cur = snap;
  }
}
