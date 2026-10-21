// 起動と画面の切り替え。ゲーム画面は 1600×900 の固定サイズで作り、ウィンドウに合わせて縮める。
import "./style.css";
import theme from "./data/theme.json" with { type: "json" };
import { initFlip } from "./ui/flip3d.ts";
import { Session } from "./ui/game/session.ts";
import { showDeckEditor } from "./ui/screens/deck.ts";
import { showTitle } from "./ui/screens/title.ts";

const W = 1600;
const H = 900;

function applyTheme(): void {
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries(theme)) if (typeof v === "string" && k !== "_comment") r.setProperty(`--${k}`, v);
  r.setProperty("--zero", theme.zero[0]);
  r.setProperty("--sym", theme.sym[0]);
}

function fit(stage: HTMLElement): void {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  stage.style.transform = `translate(${(window.innerWidth - W * s) / 2}px, ${(window.innerHeight - H * s) / 2}px) scale(${s})`;
}

async function main(): Promise<void> {
  applyTheme();
  const stage = document.getElementById("stage")!;
  fit(stage);
  window.addEventListener("resize", () => fit(stage));
  try {
    await document.fonts.load("16px 'JetBrains Mono ABC'");
    await document.fonts.load("bold 16px 'JetBrains Mono ABC'");
  } catch {
    // フォントが読めなくても代わりの等幅フォントで動く
  }
  initFlip();
  const params = new URLSearchParams(location.search);
  for (;;) {
    const c = params.has("tutorial") ? ({ kind: "tutorial" } as const) : await showTitle(stage);
    params.delete("tutorial");
    if (c.kind === "deck") {
      await showDeckEditor(stage);
      continue;
    }
    await new Promise<void>((resolve) => {
      const session = new Session(stage, {
        mode: c.kind,
        decks: c.kind === "tutorial" ? [{ units: [], symbols: [] }, { units: [], symbols: [] }] : c.decks,
        onExit: resolve,
      });
      (window as unknown as { __abc: Session }).__abc = session;
      session.start();
    });
  }
}

void main();
