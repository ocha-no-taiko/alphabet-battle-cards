// ルールの一覧（text.json の rules）。対戦中もタイトルからも開ける。
import text from "../../data/text.json" with { type: "json" };
import { openModal } from "../game/dialogs.ts";
import { esc } from "../text.ts";

export function rulesHtml(): string {
  return text.rules
    .map((sec) => `<section><h3>┤ ${esc(sec.title)} ├</h3>${sec.body.map((b) => `<p>${esc(b)}</p>`).join("")}</section>`)
    .join("");
}

export function rulesOverlay(host: HTMLElement): void {
  const m = openModal(host, "rules-dlg");
  m.el.innerHTML = `<div class="dlg-head"><span class="ttl">${text.title.rules}</span></div>
    <div class="rules-body">${rulesHtml()}</div>
    <div class="dlg-buttons"><button class="btn" data-cancel>[ ${text.dialog.close} ]</button></div>`;
  m.el.querySelector("[data-cancel]")!.addEventListener("click", () => m.close());
}
