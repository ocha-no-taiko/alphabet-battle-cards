// デック編集。ユニット 7 文字と記号 13 種類を選んで、ブラウザに保存する（数字 30 枚は固定）。
import text from "../../data/text.json" with { type: "json" };
import theme from "../../data/theme.json" with { type: "json" };
import { ATTRS, DECK_PRESETS, DECK_RULES, LETTERS, SYMBOLS, SYMBOL_IDS, UNITS, validateDeck } from "../../engine/data.ts";
import { artToHtml, symbolArt, unitArt } from "../ascii.ts";
import { attrIcon } from "../game/view.ts";
import { prefs, savePrefs, type CustomDeck } from "../prefs.ts";
import { esc, fmt } from "../text.ts";
import { fakeUnit } from "./title.ts";
import { playBgm } from "../audio.ts";
import { cover } from "../fx.ts";

const K = text.deck;

function unitDetail(letter: string): string {
  const d = UNITS[letter];
  const a = ATTRS[d.attr];
  const [c1] = (theme.attr as Record<string, string[]>)[d.attr];
  const gain = { hp: 5 + a.hpBonus, atk: 5 + a.atkBonus };
  return `<h3 style="color:${c1}">${attrIcon(d.attr, c1)} ${letter.toLowerCase()} → ${letter} <span class="dim">${a.label}</span></h3>
    <p>HP ${d.hp} → ${d.hp + gain.hp}　ATK ${d.atk} → ${d.atk + gain.atk}</p>
    <p><b style="color:${c1}">${d.skill.name}</b>　${text.detail.cost} <b style="color:${theme.gold}">${d.skill.cost}</b></p>
    <div class="form"><span class="dim">${text.detail.lower}</span> ${d.skill.lower.text}</div>
    <div class="form"><span class="dim">${text.detail.upper}</span> ${d.skill.upper.text}</div>
    <p class="dim">${fmt(text.detail.attrRule, { rule: a.ruleText })}</p>`;
}

function symDetail(id: string): string {
  const d = SYMBOLS[id];
  return `<h3 style="color:${theme.sym[0]}">${esc(d.label)}　<span class="dim">${d.name}</span></h3><p>${d.text}</p>`;
}

export function showDeckEditor(stage: HTMLElement): Promise<void> {
  const root = document.createElement("div");
  root.className = "screen deck";
  stage.appendChild(root);
  playBgm("deck");
  const first = prefs.decks[0];
  let editing: CustomDeck = first
    ? structuredClone(first)
    : { id: String(Date.now()), name: K.mine, units: [...DECK_PRESETS[0].units], symbols: [...DECK_PRESETS[0].symbols] };
  let msg = "";
  const render = () => {
    const errs = validateDeck(editing);
    const total = editing.units.length + editing.symbols.length + DECK_RULES.numberValues.length * DECK_RULES.numberCopies;
    const attrs = Object.keys(ATTRS).map((k) => `${ATTRS[k as keyof typeof ATTRS].icon}${editing.units.filter((u) => UNITS[u].attr === k).length}`).join(" ");
    const loadOpts = [
      ...prefs.decks.map((d) => `<option value="custom:${d.id}">★ ${esc(d.name)}</option>`),
      ...DECK_PRESETS.map((d) => `<option value="preset:${d.id}">${esc(d.name)}（${esc(d.note)}）</option>`),
    ].join("");
    root.innerHTML = `
      <div class="deck-left">
        <h2>┤ ${K.units} ├ <span class="dim">${editing.units.length}/${DECK_RULES.unitCount}</span></h2>
        <div class="grid units">${LETTERS.map((l) => `<pre class="card s-mini pick ${editing.units.includes(l) ? "selected" : "off"}" data-unit="${l}">${artToHtml(unitArt(fakeUnit(l)))}</pre>`).join("")}</div>
        <h2>┤ ${K.symbols} ├ <span class="dim">${editing.symbols.length}/${DECK_RULES.symbolCount}</span></h2>
        <div class="grid syms">${SYMBOL_IDS.map((s) => `<pre class="card s-mini pick ${editing.symbols.includes(s) ? "selected" : "off"}" data-sym="${esc(s)}">${artToHtml(symbolArt(s))}</pre>`).join("")}</div>
        <p class="dim">${K.numbers}</p>
      </div>
      <div class="deck-right panel"><div class="ttl">${K.title}</div>
        <label>${K.name}<input type="text" data-name maxlength="16" value="${esc(editing.name)}"></label>
        <p>${fmt(K.count, { u: editing.units.length, s: editing.symbols.length, t: total })}</p>
        <p class="dim">${fmt(K.attrCount, { list: attrs })}</p>
        <p class="${errs.length ? "bad" : "ok"} small">${errs.length ? K.invalid : "OK"}</p>
        <div class="dlg-buttons"><button class="btn hot" data-save ${errs.length ? "disabled" : ""}>[ ${K.save} ]</button>
          <button class="btn" data-new>[ ${K.new} ]</button>
          <button class="btn" data-del ${prefs.decks.some((d) => d.id === editing.id) ? "" : "disabled"}>[ ${K.delete} ]</button></div>
        <p class="ok small">${msg}</p>
        <label>${K.presets}<select data-load><option value="">—</option>${loadOpts}</select></label>
        <div class="deck-detail detail-body"><p class="dim">${text.detail.empty}</p></div>
        <div class="dlg-buttons"><button class="btn" data-back>[ ${K.back} ]</button></div>
      </div>`;
    msg = "";
  };
  render();
  return new Promise((resolve) => {
    root.addEventListener("mouseover", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".pick");
      const det = root.querySelector(".deck-detail");
      if (!el || !det) return;
      det.innerHTML = el.dataset.unit ? unitDetail(el.dataset.unit) : symDetail(el.dataset.sym!);
    });
    root.addEventListener("input", (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.name !== undefined) editing.name = t.value || K.mine;
    });
    root.addEventListener("change", (e) => {
      const t = e.target as HTMLSelectElement;
      if (t.dataset.load === undefined || !t.value) return;
      const [kind, id] = t.value.split(":");
      if (kind === "custom") editing = structuredClone(prefs.decks.find((d) => d.id === id)!);
      else {
        const p = DECK_PRESETS.find((d) => d.id === id)!;
        editing = { id: editing.id, name: editing.name, units: [...p.units], symbols: [...p.symbols] };
      }
      render();
    });
    root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const card = t.closest<HTMLElement>(".pick");
      if (card?.dataset.unit) {
        const l = card.dataset.unit;
        if (editing.units.includes(l)) editing.units = editing.units.filter((x) => x !== l);
        else if (editing.units.length < DECK_RULES.unitCount) editing.units.push(l);
        return render();
      }
      if (card?.dataset.sym) {
        const s = card.dataset.sym;
        if (editing.symbols.includes(s)) editing.symbols = editing.symbols.filter((x) => x !== s);
        else if (editing.symbols.length < DECK_RULES.symbolCount) editing.symbols.push(s);
        return render();
      }
      if (t.closest("[data-save]")) {
        const i = prefs.decks.findIndex((d) => d.id === editing.id);
        if (i >= 0) prefs.decks[i] = structuredClone(editing);
        else prefs.decks.push(structuredClone(editing));
        prefs.lastDeck = `custom:${editing.id}`;
        savePrefs();
        msg = K.saved;
        return render();
      }
      if (t.closest("[data-new]")) {
        editing = { id: String(Date.now()), name: `${K.mine}${prefs.decks.length + 1}`, units: [], symbols: [] };
        return render();
      }
      if (t.closest("[data-del]")) {
        prefs.decks = prefs.decks.filter((d) => d.id !== editing.id);
        savePrefs();
        editing = prefs.decks[0] ? structuredClone(prefs.decks[0]) : { id: String(Date.now()), name: K.mine, units: [], symbols: [] };
        return render();
      }
      if (t.closest("[data-back]")) {
        void cover().then(() => {
          root.remove();
          resolve();
        });
      }
    });
  });
}
