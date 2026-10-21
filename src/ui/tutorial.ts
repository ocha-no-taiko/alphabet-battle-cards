// チュートリアルの進行。tutorial.json の steps を順に出し、指定の操作（wait.action）やイベント（wait.event）で次へ進む。
// next の手順が出ている間は対戦の進行を止める（gate）。
import tutorialJson from "../data/tutorial.json" with { type: "json" };
import text from "../data/text.json" with { type: "json" };
import type { Action, GameEvent, GameState } from "../engine/types.ts";
import { esc } from "./text.ts";

interface Wait {
  action?: string;
  event?: string;
  value?: number;
  letter?: string;
  sym?: string;
  main?: string;
  subs?: string[];
}

interface Step {
  id: string;
  text: string;
  next?: boolean;
  last?: boolean;
  when?: "myTurn";
  wait?: Wait;
  target?: string;
}

export const TUTORIAL = tutorialJson;

export class Tutorial {
  private steps = tutorialJson.steps as Step[];
  private i = 0;
  private box: HTMLElement;
  private gateWaiters: (() => void)[] = [];
  private s: GameState | null = null;
  done = false;
  onFinish: () => void = () => {};

  constructor(private host: HTMLElement) {
    this.box = document.createElement("div");
    this.box.className = "tut-box";
    host.appendChild(this.box);
    this.box.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-next]")) this.advance();
    });
  }

  private get step(): Step | null {
    return this.done ? null : this.steps[this.i] ?? null;
  }

  private visible(): boolean {
    const st = this.step;
    if (!st || !this.s) return !!st;
    if (st.when === "myTurn") return this.s.phase === "main" && this.s.current === 0 && this.s.pending.length === 0;
    return true;
  }

  private blocking(): boolean {
    const st = this.step;
    return !!st && !!st.next && this.visible();
  }

  /** 次へ進むボタンの手順が出ている間は待つ */
  gate(): Promise<void> {
    if (!this.blocking()) return Promise.resolve();
    return new Promise((r) => this.gateWaiters.push(r));
  }

  private advance(): void {
    const st = this.step;
    if (!st) return;
    if (st.last) {
      this.finish();
      return;
    }
    this.i++;
    this.update(this.s);
  }

  finish(): void {
    this.done = true;
    this.box.remove();
    this.clearHighlight();
    this.flush();
    this.onFinish();
  }

  private flush(): void {
    if (this.blocking()) return;
    const ws = this.gateWaiters.splice(0);
    ws.forEach((w) => w());
  }

  private clearHighlight(): void {
    this.host.querySelectorAll(".tut-hl").forEach((el) => el.classList.remove("tut-hl"));
  }

  /** 盤面を描いたあとに呼ぶ（吹き出しと強調表示の更新） */
  update(s: GameState | null): void {
    this.s = s;
    this.clearHighlight();
    const st = this.step;
    if (!st) return;
    if (!this.visible()) {
      this.box.classList.add("hidden");
      return;
    }
    this.box.classList.remove("hidden");
    this.box.innerHTML = `<div class="tut-step">TUTORIAL ${this.i + 1}/${this.steps.length}</div>
      <p>${esc(st.text).replace(/\n/g, "<br>")}</p>
      ${st.next ? `<div class="dlg-buttons"><button class="btn hot" data-next>[ ${st.last ? text.dialog.close : "次へ"} ]</button></div>` : ""}`;
    if (st.target) this.host.querySelectorAll(`[data-tut="${st.target}"]`).forEach((el) => el.classList.add("tut-hl"));
    this.flush();
  }

  /** いまの手順で、その操作をしてよいか */
  allows(a: Action, s: GameState): boolean {
    const st = this.step;
    if (!st) return true;
    if (this.blocking()) return false;
    const w = st.wait;
    if (!w?.action) return true; // イベント待ちの手順は自由に操作できる
    if (a.type !== w.action) return false;
    const c = "card" in a ? s.cards[a.card] : null;
    if (w.value !== undefined && !(c?.kind === "num" && c.value === w.value)) return false;
    if (w.sym && !(c?.kind === "sym" && c.sym === w.sym)) return false;
    if (w.letter && a.type === "useSkill") {
      const u = s.cards[a.unit];
      if (!(u.kind === "unit" && u.letter === w.letter)) return false;
    }
    return true;
  }

  /** 準備の手順で、指定どおりに選んでいるか（違えばメッセージ） */
  validateSetup(s: GameState, main: number | null, subs: number[]): string | null {
    const w = this.step?.wait;
    if (!w || w.action !== "setup") return null;
    const letter = (id: number) => (s.cards[id] as { letter?: string }).letter;
    const ok = main !== null && letter(main) === w.main &&
      subs.map(letter).sort().join() === [...(w.subs ?? [])].sort().join();
    return ok ? null : `メインに ${w.main?.toLowerCase()}、サブに ${(w.subs ?? []).map((x) => x.toLowerCase()).join("・")} を選んでください`;
  }

  /** 操作のあとに呼ぶ。byHuman はプレイヤー自身の操作のとき true（CPU の操作では action 待ちを進めない） */
  onAction(a: Action, events: GameEvent[], s: GameState, byHuman: boolean): void {
    const w = this.step?.wait;
    const hitAction = !!w?.action && byHuman && w.action === a.type;
    const hitEvent = !!w?.event && events.some((e) => e.t === w.event);
    if (hitAction || hitEvent) this.i++;
    this.update(s);
  }
}
