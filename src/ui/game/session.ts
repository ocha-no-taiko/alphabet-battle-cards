// 1 回の対戦。ループで「いま誰の操作か」を見て、CPU なら考えさせ、人なら入力を待つ。
// 操作の結果は animate で見せてから状態を差し替える。
import text from "../../data/text.json" with { type: "json" };
import theme from "../../data/theme.json" with { type: "json" };
import { cpuAction, makeCpu, type Cpu } from "../../ai/cpu.ts";
import { applyAction, createGame, type CreateOptions } from "../../engine/game.ts";
import { other, waitingFor } from "../../engine/query.ts";
import type { Action, DeckList, GameEvent, GameState, PlayerId } from "../../engine/types.ts";
import { setLayer, setSpeed } from "../flip3d.ts";
import { esc, fmt } from "../text.ts";
import { Tutorial, TUTORIAL } from "../tutorial.ts";
import { animateEvents } from "./animate.ts";
import {
  chooseMainDialog, confirmDialog, gameOverScreen, listDialog, passScreen, setupDialog, skillDialog, symbolDialog,
} from "./dialogs.ts";
import { logLine } from "./log.ts";
import { detailHtml, renderBoard } from "./view.ts";
import { rulesOverlay } from "../screens/rules.ts";
import { prefs, savePrefs } from "../prefs.ts";

export type Mode = "cpu" | "hotseat" | "tutorial";

export interface SessionOpts {
  mode: Mode;
  decks: [DeckList, DeckList];
  onExit: () => void;
}

const S = text.status;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Session {
  private s: GameState;
  private viewer: PlayerId = 0;
  private humans: [boolean, boolean];
  private cpus: [Cpu, Cpu];
  private names: [string, string];
  private root: HTMLElement;
  private board!: HTMLElement;
  private hover: number | null = null;
  private resolveInput: ((a: Action) => void) | null = null;
  private busy = false;
  private exited = false;
  private tutorial: Tutorial | null = null;
  private dialogOpen = false;

  constructor(private stage: HTMLElement, private opts: SessionOpts) {
    const seed = (Math.random() * 2 ** 31) | 0;
    const tut = opts.mode === "tutorial";
    const create: CreateOptions = tut
      ? { decks: TUTORIAL.decks as [DeckList, DeckList], seed: TUTORIAL.seed, stack: TUTORIAL.stack as [string[], string[]], first: TUTORIAL.first as PlayerId }
      : { decks: opts.decks, seed };
    this.s = createGame(create);
    this.humans = opts.mode === "hotseat" ? [true, true] : [true, false];
    this.cpus = [makeCpu("normal", seed + 1), makeCpu(tut ? "passive" : "normal", seed + 2)];
    this.names = opts.mode === "hotseat" ? [text.names.p1, text.names.p2] : [text.names.you, text.names.cpu];
    this.root = document.createElement("div");
    this.root.className = "screen game";
    stage.appendChild(this.root);
    this.layout();
    if (tut) {
      this.tutorial = new Tutorial(this.root);
      this.tutorial.onFinish = () => {
        this.cpus[1].level = "normal";
      };
    }
    setLayer("front");
    setSpeed(prefs.speed);
  }

  private layout(): void {
    this.root.innerHTML = `
      <div class="topbar">
        <span class="logo"><b style="color:${theme.attr.Diagonal[0]}">A</b><b style="color:${theme.attr.Mixed[0]}">B</b><b style="color:${theme.attr.Curved[0]}">C</b></span>
        <span class="turn-text"></span>
        <span class="top-buttons">
          <button class="btn small" data-rules>[ ${S.rules} ]</button>
          <button class="btn small" data-speed></button>
          <button class="btn small" data-quit>[ ${S.menu} ]</button>
        </span>
      </div>
      <div class="board"></div>
      <div class="side">
        <div class="panel status"><div class="ttl">STATUS</div><div class="status-body"></div></div>
        <div class="panel detail"><div class="ttl">DETAIL</div><div class="detail-body"></div></div>
        <div class="panel log"><div class="ttl">LOG</div><div class="log-body"></div></div>
      </div>`;
    this.board = this.root.querySelector(".board")!;
    this.board.addEventListener("click", (e) => this.onBoardClick(e));
    this.board.addEventListener("mouseover", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".card[data-id]");
      if (el) this.setHover(Number(el.dataset.id));
    });
    this.root.querySelector("[data-rules]")!.addEventListener("click", () => rulesOverlay(this.stage));
    this.root.querySelector("[data-speed]")!.addEventListener("click", () => {
      prefs.speed = prefs.speed > 1 ? 1 : 2.2;
      savePrefs();
      setSpeed(prefs.speed);
      this.renderTop();
    });
    this.root.querySelector("[data-quit]")!.addEventListener("click", async () => {
      if (this.s.phase === "over" || (await confirmDialog(this.root, S.confirmQuit))) this.exit();
    });
    this.root.querySelector(".status-body")!.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-end]")) this.submit({ type: "endTurn", player: this.viewer });
    });
  }

  start(): void {
    this.render(this.s);
    void this.loop();
  }

  exit(): void {
    this.exited = true;
    this.resolveInput = null;
    this.root.remove();
    this.opts.onExit();
  }

  // ---- 描画 ----

  private render(s: GameState, hidden?: Set<number>): void {
    const interactive = !!this.resolveInput && !this.busy && this.humans[this.viewer] && !s.pending.length;
    this.board.innerHTML = renderBoard({ s, viewer: this.viewer, names: this.names, interactive, hidden });
    this.layoutHands();
    this.renderTop(s);
    this.renderStatus(s);
    this.renderDetail(s);
    this.tutorial?.update(s);
  }

  /** ハンドが多いときは重ねて並べる */
  private layoutHands(): void {
    this.board.querySelectorAll<HTMLElement>(".hand").forEach((h) => {
      const cards = [...h.querySelectorAll<HTMLElement>(".card")];
      if (!cards.length) return;
      const avail = h.clientWidth;
      const w = cards[0].offsetWidth;
      const gap = 8;
      const step = cards.length > 1 ? Math.min(w + gap, (avail - w) / (cards.length - 1)) : 0;
      cards.forEach((c, i) => {
        c.style.left = `${i * step}px`;
        c.style.zIndex = String(i + 1);
      });
    });
  }

  private renderTop(s = this.s): void {
    const t = this.root.querySelector(".turn-text")!;
    const who = s.phase === "setup" ? S.setup : this.turnLabel(s.current);
    t.textContent = s.phase === "setup" ? S.setup : `${fmt(S.turn, { n: s.turnNumber })} · ${who}`;
    this.root.querySelector("[data-speed]")!.textContent = `[ ${S.speed}: ${prefs.speed > 1 ? S.speedFast : S.speedNormal} ]`;
  }

  private turnLabel(p: PlayerId): string {
    if (this.opts.mode === "hotseat") return fmt(S.pTurn, { who: this.names[p] });
    return p === 0 ? S.yourTurn : S.cpuTurn;
  }

  private renderStatus(s: GameState): void {
    const el = this.root.querySelector(".status-body")!;
    if (s.phase === "setup") {
      el.innerHTML = `<div class="who-big">${S.setup}</div>`;
      return;
    }
    const t = s.turn;
    const mine = s.current === this.viewer;
    const canEnd = mine && !!this.resolveInput && !this.busy && !s.pending.length && s.phase === "main";
    const pend = s.pending[0];
    const counter = (label: string, used: number, max: number) =>
      `<span class="counter ${used >= max ? "spent" : ""}">${label} <b>${used}</b>/${max}</span>`;
    el.innerHTML = `
      <div class="who-big" style="color:${s.current === 0 ? theme.accent : theme.accent2}">${pend ? fmt(S.waitChoose, { who: this.names[pend.player] }) : this.turnLabel(s.current)}</div>
      <div class="counters">${counter(S.number, t.numbersPlaced, t.numbersAllowed)}${counter(S.skill, t.skillsUsed, t.skillsAllowed)}${counter(S.symbol, t.symbolsUsed, t.symbolsAllowed)}</div>
      <button class="btn end ${canEnd ? "hot" : ""}" data-end data-tut="end-turn" ${canEnd ? "" : "disabled"}>[ ${S.endTurn} ]</button>
      <p class="hint dim">${S.hint}</p>`;
  }

  private renderDetail(s: GameState): void {
    this.root.querySelector(".detail-body")!.innerHTML = detailHtml(s, this.hover, this.viewer);
  }

  private setHover(id: number | null): void {
    this.hover = id;
    this.renderDetail(this.s);
  }

  private log(evs: GameEvent[], s: GameState): void {
    const body = this.root.querySelector(".log-body")!;
    for (const ev of evs) {
      const line = logLine(ev, s, this.viewer, this.names);
      if (!line) continue;
      const div = document.createElement("div");
      div.className = `log-line ${ev.t}`;
      if ("p" in ev) div.style.setProperty("--who", ev.p === 0 ? theme.accent : theme.accent2);
      div.innerHTML = line;
      body.appendChild(div);
    }
    while (body.childElementCount > 300) body.firstElementChild!.remove();
    body.scrollTop = body.scrollHeight;
  }

  toast(msg: string): void {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  // ---- 入力 ----

  private async onBoardClick(e: MouseEvent): Promise<void> {
    const t = e.target as HTMLElement;
    const pileEl = t.closest<HTMLElement>("[data-pile]");
    if (pileEl?.dataset.pile?.startsWith("trash")) {
      const p = Number(pileEl.dataset.pile.split("-")[1]) as PlayerId;
      listDialog(this.root, this.s, fmt(text.dialog.trash, { who: this.names[p], n: this.s.players[p].trash.length }), [...this.s.players[p].trash].reverse());
      return;
    }
    const el = t.closest<HTMLElement>(".card[data-id]");
    if (!el || !this.resolveInput || this.busy || this.dialogOpen) return;
    const id = Number(el.dataset.id);
    const s = this.s;
    const p = this.viewer;
    const c = s.cards[id];
    if (c.owner !== p) return;
    const pl = s.players[p];
    if (pl.hand.includes(id) && c.kind === "num") return this.submit({ type: "placeNumber", player: p, card: id });
    if (pl.hand.includes(id) && c.kind === "sym") {
      const a: Action = { type: "useSymbol", player: p, card: id };
      if (!this.precheck(a)) return;
      this.dialogOpen = true;
      const act = await symbolDialog(this.root, s, p, id);
      this.dialogOpen = false;
      if (act) this.submit(act);
      return;
    }
    if (c.kind === "unit" && (pl.main === id || pl.subs.includes(id))) {
      const a: Action = { type: "useSkill", player: p, unit: id, payment: [] };
      if (!this.precheck(a)) return;
      this.dialogOpen = true;
      const act = await skillDialog(this.root, s, p, id);
      this.dialogOpen = false;
      if (act) this.submit(act);
    }
  }

  /** ダイアログを開く前に、そもそもできる操作かを確かめる（支払いと選択は除く） */
  private precheck(a: Action): boolean {
    if (this.tutorial && !this.tutorial.allows(a, this.s)) {
      this.toast(text.err.tutorial);
      return false;
    }
    const r = applyAction(this.s, a);
    if (!r.ok && r.error !== "payment" && r.error !== "choices") {
      this.toast((text.err as Record<string, string>)[r.error] ?? r.error);
      return false;
    }
    return true;
  }

  private submit(a: Action): void {
    if (!this.resolveInput || this.busy) return;
    if (this.tutorial && !this.tutorial.allows(a, this.s)) return this.toast(text.err.tutorial);
    const r = applyAction(this.s, a);
    if (!r.ok) return this.toast((text.err as Record<string, string>)[r.error] ?? r.error);
    const res = this.resolveInput;
    this.resolveInput = null;
    res(a);
  }

  private waitInput(): Promise<Action> {
    return new Promise((resolve) => {
      this.resolveInput = resolve;
      this.render(this.s);
    });
  }

  // ---- 進行 ----

  private async perform(a: Action, byHuman: boolean): Promise<void> {
    const r = applyAction(this.s, a, { trace: true });
    if (!r.ok) {
      this.toast((text.err as Record<string, string>)[r.error] ?? r.error);
      return;
    }
    this.busy = true;
    const prev = this.s;
    await animateEvents(
      {
        board: this.board,
        viewer: this.viewer,
        names: this.names,
        speed: prefs.speed,
        render: (s, hidden) => this.render(s, hidden),
        onEvents: (evs, s) => this.log(evs, s),
      },
      prev,
      r.events,
    );
    for (const ev of r.events) delete ev.snap;
    this.s = r.state;
    this.busy = false;
    this.tutorial?.onAction(a, r.events, r.state, byHuman);
    this.render(this.s);
  }

  private async loop(): Promise<void> {
    while (!this.exited) {
      if (this.tutorial) await this.tutorial.gate();
      if (this.exited) return;
      const s = this.s;
      if (s.phase === "over") return this.gameOver();
      const who = waitingFor(s);
      if (s.phase === "setup") {
        await this.setupPhase(who);
        continue;
      }
      const p = who[0];
      if (!this.humans[p]) {
        await wait(380 / prefs.speed);
        if (this.exited) return;
        await this.perform(cpuAction(this.s, p, this.cpus[p]), false);
        continue;
      }
      if (this.opts.mode === "hotseat" && this.viewer !== p) {
        this.board.innerHTML = "";
        await passScreen(this.root, this.names[p], this.names[other(p)]);
        this.viewer = p;
        this.render(this.s);
      }
      if (s.pending.length) {
        this.render(s);
        this.dialogOpen = true;
        const a = await chooseMainDialog(this.root, s, p);
        this.dialogOpen = false;
        await this.perform(a, true);
        continue;
      }
      const a = await this.waitInput();
      if (this.exited) return;
      await this.perform(a, true);
    }
  }

  private async setupPhase(who: PlayerId[]): Promise<void> {
    // CPU が先に決める（人の「決定」で開始の演出が始まるように）
    for (const p of [...who].sort((a, b) => Number(this.humans[a]) - Number(this.humans[b]))) {
      if (!this.humans[p]) {
        const a = this.tutorial ? this.tutorialCpuSetup(p) : cpuAction(this.s, p, this.cpus[p]);
        // 相手の準備が先に済んでいれば、ここで開始の演出になる
        await this.perform(a, false);
        continue;
      }
      if (this.opts.mode === "hotseat" && this.viewer !== p) {
        this.board.innerHTML = "";
        await passScreen(this.root, this.names[p], this.names[other(p)]);
        this.viewer = p;
      }
      this.render(this.s);
      this.dialogOpen = true;
      const a = await setupDialog(this.root, this.s, p, this.names[p], (main, subs) => this.tutorial?.validateSetup(this.s, main, subs) ?? null);
      this.dialogOpen = false;
      await this.perform(a, true);
    }
  }

  private tutorialCpuSetup(p: PlayerId): Action {
    const pool = this.s.players[p].pool;
    const byLetter = (l: string) => pool.find((id) => (this.s.cards[id] as { letter?: string }).letter === l)!;
    const cs = TUTORIAL.cpuSetup;
    return { type: "setup", player: p, main: byLetter(cs.main), subs: cs.subs.map(byLetter) };
  }

  private async gameOver(): Promise<void> {
    const s = this.s;
    const O = text.over;
    const w = s.winner!;
    const hot = this.opts.mode === "hotseat";
    const title = hot ? fmt(O.pWin, { who: this.names[w] }) : w === 0 ? O.win : O.lose;
    const reason = s.endReason === "kos" ? fmt(O.byKos, { n: s.rules.winKOs }) : O.byNoUnits;
    const choice = await gameOverScreen(this.root, title, `${esc(reason)}・${fmt(O.turns, { n: s.turnNumber })}`, hot || w === 0);
    if (choice === "again") {
      this.root.remove();
      const next = new Session(this.stage, this.opts.mode === "tutorial" ? { ...this.opts, mode: "cpu" } : this.opts);
      next.start();
    } else this.exit();
  }
}
