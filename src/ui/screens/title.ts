// タイトル画面。背景で Three.js のカードがゆっくり回る。
import text from "../../data/text.json" with { type: "json" };
import theme from "../../data/theme.json" with { type: "json" };
import { DECK_PRESETS, LETTERS, SYMBOL_IDS, validateDeck } from "../../engine/data.ts";
import { freshUnitState } from "../../engine/query.ts";
import type { DeckList, UnitCard } from "../../engine/types.ts";
import { artToHtml, bannerArt, numberArt, symbolArt, unitArt, type Art } from "../ascii.ts";
import { setLayer, startAmbient, stopAmbient } from "../flip3d.ts";
import { prefs, savePrefs } from "../prefs.ts";
import { esc } from "../text.ts";
import { rulesOverlay } from "./rules.ts";

const T = text.title;

export type TitleChoice =
  | { kind: "cpu"; decks: [DeckList, DeckList] }
  | { kind: "hotseat"; decks: [DeckList, DeckList] }
  | { kind: "tutorial" }
  | { kind: "deck" };

export function deckOptions(): { id: string; name: string; deck: DeckList }[] {
  const out = DECK_PRESETS.map((d) => ({ id: `preset:${d.id}`, name: d.name, deck: d as DeckList }));
  for (const d of prefs.decks) if (!validateDeck(d).length) out.push({ id: `custom:${d.id}`, name: `★ ${d.name}`, deck: d });
  return out;
}

function resolveDeck(id: string): DeckList {
  if (id === "random") return DECK_PRESETS[Math.floor(Math.random() * DECK_PRESETS.length)];
  return deckOptions().find((d) => d.id === id)?.deck ?? DECK_PRESETS[0];
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
    <pre class="logo-art">${artToHtml(logo)}</pre>
    <p class="tagline">${T.tagline}</p>
    <div class="menu" data-view="main">
      <button class="btn menu-item" data-go="cpu">${T.vsCpu}</button>
      <button class="btn menu-item" data-go="hotseat">${T.hotseat}</button>
      <button class="btn menu-item" data-go="tutorial">${T.tutorial}</button>
      <button class="btn menu-item" data-go="deck">${T.deck}</button>
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
    <p class="footer dim">${T.footer}</p>`;
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
  return new Promise((resolve) => {
    const done = (c: TitleChoice) => {
      window.removeEventListener("keydown", onKey);
      stopAmbient();
      root.remove();
      resolve(c);
    };
    root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const go = t.closest<HTMLElement>("[data-go]")?.dataset.go;
      if (go === "cpu" || go === "hotseat") return view(go);
      if (go === "tutorial") return done({ kind: "tutorial" });
      if (go === "deck") return done({ kind: "deck" });
      if (go === "rules") return rulesOverlay(stage);
      if (t.closest("[data-back]")) return view("main");
      const start = t.closest<HTMLElement>("[data-start]")?.dataset.start;
      if (start === "cpu") {
        prefs.lastDeck = value("a");
        savePrefs();
        done({ kind: "cpu", decks: [resolveDeck(value("a")), resolveDeck(value("cpu"))] });
      } else if (start === "hotseat") {
        prefs.lastDeck = value("p1");
        prefs.lastDeck2 = value("p2");
        savePrefs();
        done({ kind: "hotseat", decks: [resolveDeck(value("p1")), resolveDeck(value("p2"))] });
      }
    });
  });
}
