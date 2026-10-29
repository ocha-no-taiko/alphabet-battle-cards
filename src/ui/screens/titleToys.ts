// タイトル画面の遊び。
// ・背景で舞っているカードをクリックすると、別のカードに裏返る
// ・ロゴの ABC をクリックするとグリッチする（文字が一瞬ほかの文字に化ける）。10 回目は全部のカードが裏返る
// ・キーボードで a → b → c と打つと、全部のカードがいっせいに裏返る
import theme from "../../data/theme.json" with { type: "json" };
import { LETTERS, SYMBOL_IDS } from "../../engine/data.ts";
import { artToHtml, bannerArt, numberArt, symbolArt, unitArt, type Art } from "../ascii.ts";
import { playSe } from "../audio.ts";
import { flipAllAmbient, flipAmbient, pickAmbient } from "../flip3d.ts";
import { flash, shake, sparks } from "../fx.ts";
import { fakeUnit } from "./title.ts";

const COLORS: [string, string][] = [
  theme.attr.Diagonal as [string, string],
  theme.attr.Mixed as [string, string],
  theme.attr.Curved as [string, string],
];

export function randomCardArt(): Art {
  const r = Math.random();
  if (r < 0.45) return unitArt(fakeUnit(LETTERS[Math.floor(Math.random() * LETTERS.length)], Math.random() < 0.5));
  if (r < 0.75) return numberArt(Math.floor(Math.random() * 10));
  return symbolArt(SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)]);
}

const randomLetter = () => LETTERS[Math.floor(Math.random() * LETTERS.length)];

export function attachTitleToys(root: HTMLElement): () => void {
  const logo = root.querySelector<HTMLElement>(".logo-art")!;
  const logoHtml = logo.innerHTML;
  let clicks = 0;
  let glitching = false;
  let typed = "";

  const glitchLogo = async () => {
    clicks++;
    playSe("logo");
    const r = logo.getBoundingClientRect();
    const center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    sparks(center, [COLORS[0][0], COLORS[1][0], COLORS[2][0], theme.fg], 26, 1.3);
    shake(root, 10, 360);
    // 赤と青にずれた残像を重ねる
    for (const [dx, color] of [[-7, "#ff2e88"], [7, "#00f0c8"]] as const) {
      const ghost = logo.cloneNode(true) as HTMLElement;
      ghost.classList.remove("glitching");
      ghost.classList.add("logo-ghost");
      ghost.style.setProperty("--dx", `${dx}px`);
      ghost.style.setProperty("--tint", color);
      logo.parentElement!.appendChild(ghost);
      setTimeout(() => ghost.remove(), 520);
    }
    logo.classList.remove("glitching");
    void logo.offsetWidth;
    logo.classList.add("glitching");
    if (glitching) return;
    glitching = true;
    // 何度か別の 3 文字に化けてから ABC に戻る
    for (let i = 0; i < 4; i++) {
      const word = [randomLetter(), randomLetter(), randomLetter()].join("");
      logo.innerHTML = artToHtml(bannerArt(word, COLORS));
      await new Promise((res) => setTimeout(res, 70));
    }
    logo.innerHTML = logoHtml;
    glitching = false;
    if (clicks % 10 === 0) {
      flash("#ffffff", 0.8, 700);
      playSe("evolve");
      flipAllAmbient(() => randomCardArt());
    }
  };

  const onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest(".logo-art")) {
      void glitchLogo();
      return;
    }
    if (t.closest(".menu, .btn, select, label, .sound-toggle, .modal-back")) return;
    const i = pickAmbient(e.clientX, e.clientY);
    if (i < 0) return;
    flipAmbient(i, randomCardArt());
    playSe("flip");
    sparks({ x: e.clientX, y: e.clientY }, [theme.accent, theme.gold, theme.fg], 14, 0.8);
  };

  let moveTimer = 0;
  const onMove = (e: MouseEvent) => {
    if (moveTimer) return;
    moveTimer = window.setTimeout(() => {
      moveTimer = 0;
      const t = e.target as HTMLElement;
      const over = !t.closest(".menu, .btn, select, label, .modal-back") && (t.closest(".logo-art") || pickAmbient(e.clientX, e.clientY) >= 0);
      document.body.classList.toggle("pointing", !!over);
    }, 40);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    typed = (typed + e.key.toLowerCase()).slice(-3);
    if (typed === "abc") {
      typed = "";
      void glitchLogo();
      flash(theme.accent, 0.5, 600);
      flipAllAmbient(() => randomCardArt());
    }
  };

  // カードは画面全体（タイトルの外の余白も）を舞うので、window で受ける
  window.addEventListener("click", onClick);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("keydown", onKey);
  return () => {
    window.removeEventListener("click", onClick);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("keydown", onKey);
    clearTimeout(moveTimer);
    document.body.classList.remove("pointing");
  };
}
