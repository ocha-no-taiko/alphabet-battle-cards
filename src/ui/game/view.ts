// 対戦画面の描画。状態から盤面の HTML を組み立てる（毎回まるごと描き直す）。
// 自分（viewer）が下、相手が上。カードの要素には data-id を付け、演出（flip3d）が位置を拾えるようにしている。
import theme from "../../data/theme.json" with { type: "json" };
import text from "../../data/text.json" with { type: "json" };
import { ATTRS, SYMBOLS, UNITS } from "../../engine/data.ts";
import {
  activeEffects, autoDamage, canPlace, canUseSkill, canUseSymbol, evoRemaining, locate, other, skillCost, storageCap, sumEffect,
  unitCard,
} from "../../engine/query.ts";
import type { Effect, GameState, PlayerId } from "../../engine/types.ts";
import { artToHtml, backArt, blank, cardArt, CARD_H, CARD_W, frame, put, type Art } from "../ascii.ts";
import { fmt } from "../text.ts";
import { FX } from "../fx.ts";

export interface ViewModel {
  s: GameState;
  viewer: PlayerId;
  names: [string, string];
  /** viewer が操作できるとき true（ハンドや場のカードを光らせる） */
  interactive: boolean;
  /** 相手のハンドで表を見せるカード（@ のときなど） */
  reveal?: Set<number>;
  /** 演出で一時的に隠すカード */
  hidden?: Set<number>;
}


export function emptySlotArt(label: string): Art {
  const a = blank(CARD_W, CARD_H, "transparent");
  frame(a, 0, 0, CARD_W, CARD_H, theme.faint);
  for (let x = 1; x < CARD_W - 1; x += 2) {
    put(a, x, 0, " ", theme.faint);
    put(a, x, CARD_H - 1, " ", theme.faint);
  }
  for (let y = 1; y < CARD_H - 1; y += 2) {
    put(a, 0, y, " ", theme.faint);
    put(a, CARD_W - 1, y, " ", theme.faint);
  }
  put(a, Math.floor((CARD_W - label.length) / 2), 5, label, theme.faint);
  return a;
}

/** viewer から見えるカードの絵（伏せ札は裏面） */
export function visibleArt(s: GameState, id: number, viewer: PlayerId, reveal?: Set<number>): Art {
  const c = s.cards[id];
  const loc = locate(s, id);
  if (!loc) return cardArt(c);
  if (loc.zone === "deck") return backArt();
  if ((loc.zone === "hand" || loc.zone === "pool") && c.owner !== viewer && !reveal?.has(id)) return backArt();
  const zone = loc.zone === "main" || loc.zone === "sub" ? loc.zone : null;
  return cardArt(c, { zone, state: s });
}

export function isFaceVisible(s: GameState, id: number, viewer: PlayerId, reveal?: Set<number>): boolean {
  return !visibleArt(s, id, viewer, reveal).back;
}

function cardEl(m: ViewModel, id: number, size: string, extra = ""): string {
  const s = m.s;
  const c = s.cards[id];
  const art = visibleArt(s, id, m.viewer, m.reveal);
  const cls = ["card", `s-${size}`];
  if (m.hidden?.has(id)) cls.push("anim-hidden");
  let tut = "";
  if (c.owner === m.viewer) {
    tut = c.kind === "num" ? `card-n${c.value}` : c.kind === "sym" ? `card-s${c.sym}` : `card-u${c.letter}`;
    if (m.interactive) {
      const p = m.viewer;
      const loc = locate(s, id);
      if (loc?.zone === "hand" && c.kind === "num" && !canPlace(s, p, id)) cls.push("playable");
      if (loc?.zone === "hand" && c.kind === "sym" && !canUseSymbol(s, p, id)) cls.push("playable");
      if ((loc?.zone === "main" || loc?.zone === "sub") && !canUseSkill(s, p, id)) cls.push("usable");
    }
  }
  if (art.back) cls.push("back");
  return `<pre class="${cls.join(" ")}" data-id="${id}" ${tut ? `data-tut="${tut}"` : ""} ${extra}>${artToHtml(art)}</pre>`;
}

function slot(label: string, size: string): string {
  return `<pre class="card slot s-${size}">${artToHtml(emptySlotArt(label))}</pre>`;
}

function pile(m: ViewModel, p: PlayerId, kind: "deck" | "trash", who: "me" | "opp"): string {
  const pl = m.s.players[p];
  const ids = kind === "deck" ? pl.deck : pl.trash;
  const top = ids.length ? (kind === "deck" ? `<pre class="card s-pile back">${artToHtml(backArt())}</pre>` : cardEl(m, ids[ids.length - 1], "pile")) : slot(kind === "deck" ? "DECK" : "TRASH", "pile");
  const label = kind === "deck" ? fmt(text.status.deckCount, { n: ids.length }) : fmt(text.status.trashCount, { n: ids.length });
  return `<div class="pile" data-pile="${kind}-${p}" data-tut="${kind}-${who}">${top}<div class="pile-label">${label}</div></div>`;
}

/**
 * LETHAL（リーチ）: いまのターンの側の自動ダメージ（相手のガード・半減を引いたあと）で、相手のメインを倒せる見込みか。
 * 倒される側のプレイヤーを返す（見込みがなければ null）
 */
export function lethalTarget(s: GameState): PlayerId | null {
  if (s.phase !== "main" || s.pending.length || !FX.lethal) return null;
  const p = s.current;
  const q = other(p);
  const target = unitCard(s, s.players[q].main);
  if (!target) return null;
  let d = Math.max(0, autoDamage(s, p).total - sumEffect(s, "guard", q));
  if (activeEffects(s, "half", q).length) d = Math.ceil(d / 2);
  return d > 0 && d >= target.unit.hp ? q : null;
}

function row(m: ViewModel, p: PlayerId, who: "me" | "opp"): string {
  const s = m.s;
  const pl = s.players[p];
  const cap = storageCap(s, p);
  const storage: string[] = pl.storage.map((id) => cardEl(m, id, "store"));
  for (let i = pl.storage.length; i < cap; i++) storage.push(slot(i < s.rules.storageMax ? "NUM" : "+1", "store"));
  const subs: string[] = pl.subs.map((id) => cardEl(m, id, "sub"));
  for (let i = pl.subs.length; i < s.rules.subSlots; i++) subs.push(slot("SUB", "sub"));
  const main = pl.main !== null ? cardEl(m, pl.main, "main") : slot("MAIN", "main");
  return `<div class="row ${who}" data-tut="field-${who}">
    <div class="piles">${pile(m, p, "deck", who)}${pile(m, p, "trash", who)}</div>
    <div class="storage" data-tut="storage-${who}">${storage.join("")}</div>
    <div class="subs" data-tut="subs-${who}">${subs.join("")}</div>
    <div class="main-slot ${lethalTarget(s) === p ? "lethal-target" : ""}" data-tut="main-${who}" data-main="${p}">${main}</div>
  </div>`;
}

function handRow(m: ViewModel, p: PlayerId, who: "me" | "opp"): string {
  const s = m.s;
  const order = { unit: 0, num: 1, sym: 2 } as const;
  const ids = [...s.players[p].hand];
  if (who === "me")
    ids.sort((a, b) => {
      const A = s.cards[a];
      const B = s.cards[b];
      if (A.kind !== B.kind) return order[A.kind] - order[B.kind];
      if (A.kind === "num" && B.kind === "num") return A.value - B.value;
      return a - b;
    });
  const size = who === "me" ? "hand" : "opp";
  return `<div class="hand ${who}" data-tut="hand-${who}" data-count="${ids.length}">${ids.map((id) => cardEl(m, id, size)).join("")}</div>`;
}

function effectLabel(e: Effect): string {
  const tpl = (text.effects as Record<string, string>)[e.kind] ?? e.kind;
  return fmt(tpl, { v: e.value, t: e.turns });
}

const PROTECTIVE = new Set(["guard", "half", "reflect", "protectStorage", "storageCap"]);

function chips(m: ViewModel, p: PlayerId): string {
  const s = m.s;
  const out: string[] = [];
  for (const e of s.effects) {
    const shows = PROTECTIVE.has(e.kind) ? e.owner === p : e.on === p;
    if (!shows) continue;
    out.push(`<span class="chip ${PROTECTIVE.has(e.kind) ? "good" : "bad"}">${effectLabel(e)}</span>`);
  }
  if (s.current === p && s.phase === "main") {
    const t = s.turn;
    const E = text.effects;
    if (t.autoBonus) out.push(`<span class="chip turn">${fmt(E.autoBonus, { v: t.autoBonus })}</span>`);
    if (t.subMult !== null) out.push(`<span class="chip turn">${fmt(E.subMult, { v: t.subMult })}</span>`);
    if (t.costReduce) out.push(`<span class="chip turn">${fmt(E.costReduce, { v: t.costReduce })}</span>`);
    if (t.boostCard !== null && s.players[p].storage.includes(t.boostCard)) {
      out.push(`<span class="chip turn">${fmt(E.boost, { v: t.boostAmount })}</span>`);
    }
  }
  return out.join("");
}

function infoLine(m: ViewModel, p: PlayerId, who: "me" | "opp"): string {
  const s = m.s;
  const a = autoDamage(s, p);
  const kos = s.players[p].kos;
  const match = kos === s.rules.winKOs - 1;
  const pips = Array.from({ length: s.rules.winKOs }, (_, i) =>
    `<span style="color:${i < kos ? theme.accent2 : theme.faint}">${i < kos ? "■" : "□"}</span>`).join("");
  const extra = (a.bonus ? ` +${a.bonus}` : "") + (a.minus ? ` -${a.minus}` : "");
  const tip = fmt(text.status.autoTip, { main: a.main, subs: a.subs, mult: a.mult, subPart: a.subPart, extra });
  const turnMark = s.phase === "main" && s.current === p ? `<span class="turn-mark">▶</span>` : `<span class="turn-mark off">·</span>`;
  const hand = who === "opp" ? `<span class="dim">${fmt(text.status.handCount, { n: s.players[p].hand.length })}</span>` : "";
  return `<div class="info ${who}">${turnMark}<span class="who">${m.names[p]}</span>
    <span class="ko ${match ? "match" : ""}" data-tut="ko-${who}">${text.status.ko} ${pips}</span>
    <span class="auto" data-tut="auto-${who}" title="${tip}">${text.status.auto} <b>${a.total}</b></span>${hand}
    ${match ? `<span class="match-chip">MATCH POINT</span>` : ""}
    ${lethalTarget(s) === other(p) && s.current === p ? `<span class="lethal-chip">LETHAL</span>` : ""}
    <span class="chips">${chips(m, p)}</span></div>`;
}

export function renderBoard(m: ViewModel): string {
  const me = m.viewer;
  const op = other(me);
  const res = [m.s.players[0].resolving, m.s.players[1].resolving].find((x) => x !== null);
  return `
    ${handRow(m, op, "opp")}
    ${row(m, op, "opp")}
    <div class="mid">${infoLine(m, op, "opp")}${infoLine(m, me, "me")}</div>
    ${row(m, me, "me")}
    ${handRow(m, me, "me")}
    <div class="play-area">${res != null ? cardEl(m, res, "play") : ""}</div>`;
}

// ---- 詳細パネル ----

export function attrIcon(attr: string, color: string): string {
  const st = `fill="none" stroke="${color}" stroke-width="5"`;
  const sq = `<rect x="6" y="6" width="68" height="68" ${st}/>`;
  const di = `<polygon points="40,4 76,40 40,76 4,40" ${st}/>`;
  const ci = `<circle cx="40" cy="40" r="34" ${st}/>`;
  const body = attr === "Orthogonal" ? sq : attr === "Diagonal" ? di : attr === "Curved" ? ci : sq + di + `<circle cx="40" cy="40" r="17" ${st}/>`;
  return `<svg viewBox="0 0 80 80" width="22" height="22" class="attr-icon">${body}</svg>`;
}

export function detailHtml(s: GameState, id: number | null, viewer: PlayerId, reveal?: Set<number>): string {
  if (id === null || !s.cards[id]) return `<p class="dim">${text.detail.empty}</p>`;
  const c = s.cards[id];
  const D = text.detail;
  if (!isFaceVisible(s, id, viewer, reveal)) return `<p class="dim">${D.hidden}</p>`;
  if (c.kind === "num") {
    const left = c.spent ? `<p style="color:${theme.gold}">${fmt(D.numberLeft, { left: c.value - c.spent, used: c.spent })}</p>` : "";
    return `<h3 style="color:${c.value === 0 ? theme.zero[0] : theme.num[0]}">${c.value}</h3>${left}
      <p class="dim">${D.number}</p><p>${s.rules.change ? D.numberText : D.numberTextNoChange}</p>${c.value === 0 ? `<p style="color:${theme.zero[0]}">${D.zeroText}</p>` : ""}`;
  }
  if (c.kind === "sym") {
    const d = SYMBOLS[c.sym];
    return `<h3 style="color:${theme.sym[0]}">${d.label}　<span class="dim">${d.name}</span></h3>
      <p class="dim">${D.symbol}</p><p>${d.text}</p>`;
  }
  const def = UNITS[c.letter];
  const attr = ATTRS[def.attr];
  const [c1] = (theme.attr as Record<string, string[]>)[def.attr];
  const u = c.unit;
  const loc = locate(s, id);
  const onField = loc && (loc.zone === "main" || loc.zone === "sub");
  const letter = u.evolved ? c.letter.toUpperCase() : c.letter.toLowerCase();
  const left = evoRemaining(s, id);
  const evo = u.evolved
    ? `<p style="color:${c1}">${D.evolved}</p>`
    : onField && left !== null
      ? `<p>${fmt(D.evoLeft, { n: left, t: u.tenure })}</p>`
      : `<p class="dim">${fmt(D.evoInfo, s.rules.evolveTurns)}</p>`;
  const cost = def.skill.cost;
  const nowCost = onField && loc!.p === viewer && s.current === viewer ? skillCost(s, viewer, id) : cost;
  const atk = unitCard(s, id) ? (u.evolved ? def.atk + s.rules.evolveBonus.atk + attr.atkBonus : def.atk) : def.atk;
  const form = (k: "lower" | "upper") =>
    `<div class="form ${(k === "upper") === u.evolved ? "on" : ""}"><span class="dim">${k === "lower" ? D.lower : D.upper}</span> ${def.skill[k].text}</div>`;
  return `<h3 style="color:${c1}">${attrIcon(def.attr, c1)} ${letter} <span class="dim">${attr.label}</span></h3>
    <p>${D.hp} <b style="color:${theme.hp.high}">${Math.max(0, u.hp)}</b> / ${u.maxHp}　${D.atk} <b>${atk}</b></p>
    ${evo}
    <p class="skill-name"><b style="color:${c1}">${def.skill.name}</b>　${D.cost} <b style="color:${theme.gold}">${cost}</b>${nowCost !== cost ? `（${D.costNow} ${nowCost}）` : ""}</p>
    ${form("lower")}${form("upper")}
    <p class="dim">${fmt(D.attrRule, { rule: attr.ruleText })}</p>`;
}

