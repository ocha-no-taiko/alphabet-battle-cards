// タイトル画面。背景で Three.js のカードがゆっくり回る。
import text from "../../data/text.json" with { type: "json" };
import theme from "../../data/theme.json" with { type: "json" };
import { DECK_PRESETS, LETTERS, SYMBOL_IDS, validateDeck } from "../../engine/data.ts";
import { freshUnitState } from "../../engine/query.ts";
import type { DeckList, UnitCard } from "../../engine/types.ts";
import { artToHtml, bannerArt, numberArt, symbolArt, unitArt, type Art } from "../ascii.ts";
import { setLayer, startAmbient, stopAmbient } from "../flip3d.ts";
import { prefs, savePrefs } from "../prefs.ts";
import { esc, fmt } from "../text.ts";
import { playBgm, playSe, setSound, soundOn } from "../audio.ts";
import { cover } from "../fx.ts";
import { trophyCount } from "../trophies.ts";
import { rulesOverlay } from "./rules.ts";
import { attachTitleToys } from "./titleToys.ts";

const T = text.title;

export type TitleChoice =
  | { kind: "cpu"; decks: [DeckList, DeckList]; deckIds: [string | null, string | null]; deckNames: [string, string] }
  | { kind: "hotseat"; decks: [DeckList, DeckList]; deckIds: [string | null, string | null]; deckNames: [string, string] }
  | { kind: "tutorial" }
  | { kind: "deck" }
  | { kind: "collection" };

export function deckOptions(): { id: string; name: string; deck: DeckList }[] {
  const out = DECK_PRESETS.map((d) => ({ id: `preset:${d.id}`, name: d.name, deck: d as DeckList }));
  for (const d of prefs.decks) if (!validateDeck(d).length) out.push({ id: `custom:${d.id}`, name: `★ ${d.name}`, deck: d });
  return out;
}

function resolveDeck(id: string): { deck: DeckList; presetId: string | null; name: string } {
  if (id === "random") {
    const d = DECK_PRESETS[Math.floor(Math.random() * DECK_PRESETS.length)];
    return { deck: d, presetId: d.id, name: d.name };
  }
  const opt = deckOptions().find((d) => d.id === id) ?? deckOptions()[0];
  return { deck: opt.deck, presetId: opt.id.startsWith("preset:") ? opt.id.slice(7) : null, name: opt.name.replace(/^★ /, "") };
}

function pair(a: string, b: string): Pick<Extract<TitleChoice, { kind: "cpu" }>, "decks" | "deckIds" | "deckNames"> {
  const x = resolveDeck(a);
  const y = resolveDeck(b);
  return { decks: [x.deck, y.deck], deckIds: [x.presetId, y.presetId], deckNames: [x.name, y.name] };
}

export function fakeUnit(letter: string, evolved = false): UnitCard {
  const u = freshUnitState(letter);
  return { id: -1, owner: 0, kind: "unit", letter, unit: { ...u, evolved } };
}

function ambientArts(): Art[] {
  const arts: Art[] = [];
  for (let i = 0; i < 14; i++) {
    const r = (i * 7919) % 100;
    if (i % 3 === 0) arts.push(unitArt(fakeUnit(LETTERS[(i * 5) % LETTERS.length], i % 2 === 0)));
    else if (i % 3 === 1) arts.push(numberArt(r % 10));
    else arts.push(symbolArt(SYMBOL_IDS[(i * 3) % SYMBOL_IDS.length]));
  }
  return arts;
}

export function showTitle(stage: HTMLElement): Promise<TitleChoice> {
  const root = document.createElement("div");
  root.className = "screen title";
  stage.appendChild(root);
  setLayer("behind");
  startAmbient(ambientArts());
  playBgm("title");
  const tc = trophyCount();
  const logo = bannerArt("ABC", [
    theme.attr.Diagonal as [string, string],
    theme.attr.Mixed as [string, string],
    theme.attr.Curved as [string, string],
  ]);
  const sel = (name: string, value: string, withRandom = false) =>
    `<select data-sel="${name}">${withRandom ? `<option value="random">${T.random}</option>` : ""}${deckOptions()
      .map((d) => `<option value="${d.id}" ${d.id === value ? "selected" : ""}>${esc(d.name)}</option>`)
      .join("")}</select>`;
  const lastA = deckOptions().some((d) => d.id === prefs.lastDeck) ? prefs.lastDeck : "preset:starter";
  const lastB = deckOptions().some((d) => d.id === prefs.lastDeck2) ? prefs.lastDeck2 : "preset:diagonal";
  root.innerHTML = `
    <div class="logo-wrap"><pre class="logo-art" title="click!">${artToHtml(logo)}</pre></div>
    <p class="tagline">${T.tagline}</p>
    <div class="menu" data-view="main">
      <button class="btn menu-item" data-go="cpu">${T.vsCpu}</button>
      <button class="btn menu-item" data-go="hotseat">${T.hotseat}</button>
      <button class="btn menu-item" data-go="tutorial">${T.tutorial}</button>
      <button class="btn menu-item" data-go="deck">${T.deck}</button>
      <button class="btn menu-item" data-go="collection">${text.collection.menu} <span class="dim small">${fmt(text.collection.count, tc)}</span></button>
      <button class="btn menu-item" data-go="rules">${T.rules}</button>
    </div>
    <div class="menu sub hidden" data-view="cpu">
      <label>${T.yourDeck}${sel("a", lastA)}</label>
      <label>${T.cpuDeck}${sel("cpu", "random", true)}</label>
      <button class="btn menu-item hot" data-start="cpu">${T.start}</button>
      <button class="btn menu-item" data-back>${T.back}</button>
    </div>
    <div class="menu sub hidden" data-view="hotseat">
      <label>${T.p1Deck}${sel("p1", lastA)}</label>
      <label>${T.p2Deck}${sel("p2", lastB)}</label>
      <button class="btn menu-item hot" data-start="hotseat">${T.start}</button>
      <button class="btn menu-item" data-back>${T.back}</button>
    </div>
    <p class="footer dim">${T.footer}</p>
    <button class="btn small sound-toggle" data-sound>[ ${soundOn() ? text.sound.on : text.sound.off} ]</button>`;
  const view = (name: string) => {
    root.querySelectorAll<HTMLElement>(".menu").forEach((m) => m.classList.toggle("hidden", m.dataset.view !== name));
    root.querySelector<HTMLElement>(`.menu[data-view="${name}"] button`)?.focus();
  };
  view("main");
  const value = (name: string) => root.querySelector<HTMLSelectElement>(`[data-sel="${name}"]`)!.value;
  const onKey = (e: KeyboardEvent) => {
    const items = [...root.querySelectorAll<HTMLElement>(".menu:not(.hidden) button, .menu:not(.hidden) select")];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowRight") items[(i + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === "Escape") view("main");
    else return;
    e.preventDefault();
  };
  window.addEventListener("keydown", onKey);
  const disposeToys = attachTitleToys(root);
  return new Promise((resolve) => {
    let leaving = false;
    const done = async (c: TitleChoice) => {
      if (leaving) return;
      leaving = true;
      window.removeEventListener("keydown", onKey);
      disposeToys();
      playSe("transition");
      await cover();
      stopAmbient();
      root.remove();
      resolve(c);
    };
    root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const go = t.closest<HTMLElement>("[data-go]")?.dataset.go;
      if (go === "cpu" || go === "hotseat") return view(go);
      if (t.closest("[data-sound]")) {
        setSound(!soundOn());
        t.closest("[data-sound]")!.textContent = `[ ${soundOn() ? text.sound.on : text.sound.off} ]`;
        return;
      }
      if (go === "tutorial") return void done({ kind: "tutorial" });
      if (go === "deck") return void done({ kind: "deck" });
      if (go === "collection") return void done({ kind: "collection" });
      if (go === "rules") return rulesOverlay(stage);
      if (t.closest("[data-back]")) return view("main");
      const start = t.closest<HTMLElement>("[data-start]")?.dataset.start;
      if (start === "cpu") {
        prefs.lastDeck = value("a");
        savePrefs();
        void done({ kind: "cpu", ...pair(value("a"), value("cpu")) });
      } else if (start === "hotseat") {
        prefs.lastDeck = value("p1");
        prefs.lastDeck2 = value("p2");
        savePrefs();
        void done({ kind: "hotseat", ...pair(value("p1"), value("p2")) });
      }
    });
  });
}
