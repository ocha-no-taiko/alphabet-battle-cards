// イベントをログの 1 行にする。伏せ札（相手のドローなど）は中身を書かない。
import text from "../../data/text.json" with { type: "json" };
import { UNITS } from "../../engine/data.ts";
import type { GameEvent, GameState, PlayerId } from "../../engine/types.ts";
import { cardName, esc, fmt } from "../text.ts";

const L = text.log;

export function logLine(ev: GameEvent, s: GameState, viewer: PlayerId, names: [string, string]): string | null {
  const who = (p: PlayerId) => names[p];
  const name = (id: number) => esc(cardName(s.cards[id]));
  const names2 = (ids: number[]) => ids.map(name).join(" ");
  switch (ev.t) {
    case "reveal": return L.reveal;
    case "first": return fmt(L.first, { who: who(ev.p) });
    case "mulligan": return fmt(L.mulligan, { who: who(ev.p) });
    case "turn": return fmt(L.turn, { n: ev.n, who: who(ev.p) });
    case "draw": {
      const sub = ev.toSub ? fmt(L.drawSub, { card: name(ev.id) }) : "";
      return fmt(L.draw, { who: who(ev.p), sub });
    }
    case "deckEmpty": return fmt(L.deckEmpty, { who: who(ev.p) });
    case "reshuffle": return fmt(L.reshuffle, { who: who(ev.p), n: ev.count });
    case "place": return fmt(L.place, { who: who(ev.p), card: name(ev.id) });
    case "pay": {
      const parts: string[] = [];
      if (ev.ids.length) parts.push(fmt(L.pay, { who: who(ev.p), cards: names2(ev.ids) }));
      if (ev.kept) parts.push(fmt(L.payKept, { who: who(ev.p), card: name(ev.kept.id), used: ev.kept.used, left: ev.kept.left }));
      return parts.join(" / ") || null;
    }
    case "skill": {
      const c = s.cards[ev.id];
      const skill = c.kind === "unit" ? UNITS[c.letter].skill.name : "";
      return fmt(L.skill, { who: who(ev.p), card: name(ev.id), skill });
    }
    case "symbol": return fmt(L.symbol, { who: who(ev.p), card: name(ev.id) });
    case "symbolDone": return null;
    case "damage": {
      const extra = (ev.reflected ? L.reflected : "") + (ev.raw !== ev.amount ? fmt(L.damageReduced, { raw: ev.raw }) : "");
      return fmt(L.damage, { who: who(ev.p), card: name(ev.id), n: ev.amount, extra });
    }
    case "heal": return fmt(L.heal, { who: who(ev.p), card: name(ev.id), n: ev.amount });
    case "ko": return fmt(L.ko, { who: who(ev.p), card: name(ev.id) });
    case "newMain": return fmt(L.newMain, { who: who(ev.p), card: name(ev.id) });
    case "evolve": return fmt(L.evolve, { who: who(ev.p), card: name(ev.id) });
    case "effect": {
      const tpl = (text.effects as Record<string, string>)[ev.kind] ?? ev.kind;
      return fmt(L.effect, { who: who(ev.p), effect: fmt(tpl, { v: ev.value, t: ev.value }) });
    }
    case "toHand": {
      // デックから探したカードは、相手のものなら伏せる
      const hidden = ev.p !== viewer && ev.from === "deck";
      return fmt(L.toHand, { who: who(ev.p), cards: hidden ? `${ev.ids.length} 枚` : names2(ev.ids) });
    }
    case "trashed":
      return ev.from === "hand"
        ? fmt(L.trashedHidden, { who: who(ev.p), n: ev.ids.length, cards: names2(ev.ids) })
        : fmt(L.trashed, { who: who(ev.p), cards: names2(ev.ids) });
    case "swap": return fmt(L.swap, { who: who(ev.p), a: name(ev.a), b: name(ev.b) });
    case "swapHp": return L.swapHp;
    case "revive": return fmt(L.revive, { who: who(ev.p), card: name(ev.id), where: ev.toSub ? text.zones.sub : text.zones.hand });
    case "blocked": return fmt(L.blocked, { who: who(ev.p) });
    case "auto": return fmt(L.auto, { who: who(ev.p), n: ev.amount });
    case "gameOver": return fmt(L.gameOver, { who: who(ev.winner) });
  }
}
