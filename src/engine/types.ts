// ゲームの状態と操作の型。状態は JSON で表せる値だけで持つ（structuredClone で複製できる）。

export type PlayerId = 0 | 1;
export type Attr = "Orthogonal" | "Diagonal" | "Curved" | "Mixed";

export interface UnitState {
  hp: number;
  maxHp: number;
  evolved: boolean;
  /** 在籍ターン（メインかサブにいた自分のターンの通算数） */
  tenure: number;
  /** 進化までの残りターン数の増減（Xenos で +、^ で -） */
  evoShift: number;
}

export type Card =
  | { id: number; owner: PlayerId; kind: "unit"; letter: string; unit: UnitState }
  | { id: number; owner: PlayerId; kind: "num"; value: number }
  | { id: number; owner: PlayerId; kind: "sym"; sym: string };

export type UnitCard = Extract<Card, { kind: "unit" }>;

export interface DeckList {
  units: string[];
  symbols: string[];
}

export interface PlayerState {
  deck: number[]; // [0] がいちばん上
  hand: number[];
  trash: number[];
  storage: number[];
  main: number | null;
  subs: number[];
  kos: number; // 自分が撃破した数
  /** 準備フェイズ: デックのユニット 7 枚 */
  pool: number[];
  setup: { main: number; subs: number[] } | null;
  /** 記号カードを解決している間だけ置く場所（UI の中央表示用） */
  resolving: number | null;
}

/**
 * 継続する効果。on のプレイヤーのターン中に有効で、on のターン終了時に turns を 1 減らす。
 * owner は効果を出したプレイヤー。
 */
export interface Effect {
  kind: EffectKind;
  owner: PlayerId;
  on: PlayerId;
  turns: number;
  value: number;
}

export type EffectKind =
  | "guard" // owner のメインが受けるダメージを value 減らす
  | "half" // owner のメインが受けるダメージを半分に
  | "reflect" // owner のメインが受けたダメージ × value を相手のメインに
  | "protectStorage" // owner のストレージをトラッシュさせない
  | "needle" // on のターン終了時に on のメインへ value ダメージ
  | "sealSymbol"
  | "sealStorage"
  | "sealMainSkill"
  | "costUp"
  | "autoMinus"
  | "subMultSet" // on の自動ダメージのサブ倍率を value に
  | "storageCap"; // owner のストレージ上限 +value（on = owner）

export interface TurnState {
  skillsUsed: number;
  skillsAllowed: number;
  symbolsUsed: number;
  symbolsAllowed: number;
  numbersPlaced: number;
  numbersAllowed: number;
  autoBonus: number;
  subMult: number | null;
  costReduce: number;
  boostCard: number | null;
  boostAmount: number;
}

export type Step = "auto" | "needle" | "tenure" | "switch";

export interface Pending {
  type: "chooseMain";
  player: PlayerId;
}

export type Phase = "setup" | "main" | "over";

export interface GameState {
  seed: number;
  rng: number;
  phase: Phase;
  turnNumber: number;
  current: PlayerId;
  first: PlayerId;
  players: [PlayerState, PlayerState];
  cards: Record<number, Card>;
  effects: Effect[];
  turn: TurnState;
  pending: Pending[];
  resume: Step[];
  winner: PlayerId | null;
  endReason: "kos" | "noUnits" | null;
  rules: import("./data.ts").Rules;
  nextId: number;
  /** 準備が終わるまでだけ持つ（チュートリアルの積み込みと先攻の固定） */
  setupOpts?: { stack?: [string[]?, string[]?]; first?: PlayerId };
}

export type Choices = Record<string, number[]>;

export type Action =
  | { type: "setup"; player: PlayerId; main: number; subs: number[] }
  | { type: "placeNumber"; player: PlayerId; card: number }
  | { type: "useSkill"; player: PlayerId; unit: number; payment: number[]; choices?: Choices }
  | { type: "useSymbol"; player: PlayerId; card: number; choices?: Choices }
  | { type: "endTurn"; player: PlayerId }
  | { type: "chooseMain"; player: PlayerId; card: number };

export type GameEvent = (
  | { t: "reveal" }
  | { t: "first"; p: PlayerId }
  | { t: "mulligan"; p: PlayerId }
  | { t: "turn"; p: PlayerId; n: number }
  | { t: "draw"; p: PlayerId; id: number; toSub: boolean }
  | { t: "deckEmpty"; p: PlayerId }
  | { t: "reshuffle"; p: PlayerId; count: number }
  | { t: "place"; p: PlayerId; id: number }
  | { t: "pay"; p: PlayerId; ids: number[] }
  | { t: "skill"; p: PlayerId; id: number }
  | { t: "symbol"; p: PlayerId; id: number }
  | { t: "symbolDone"; p: PlayerId; id: number }
  | { t: "damage"; p: PlayerId; id: number; amount: number; raw: number; reflected?: boolean }
  | { t: "heal"; p: PlayerId; id: number; amount: number }
  | { t: "ko"; p: PlayerId; id: number }
  | { t: "newMain"; p: PlayerId; id: number }
  | { t: "evolve"; p: PlayerId; id: number }
  | { t: "effect"; p: PlayerId; kind: EffectKind | "autoBonus" | "subMult" | "extraSkill" | "extraSymbol" | "extraStorage" | "costReduce" | "boost" | "evoShift" | "cleanse"; value: number }
  | { t: "toHand"; p: PlayerId; ids: number[]; from: "deck" | "trash" | "storage" | "sub" }
  | { t: "trashed"; p: PlayerId; ids: number[]; from: "hand" | "storage" }
  | { t: "swap"; p: PlayerId; a: number; b: number }
  | { t: "swapHp"; p: PlayerId }
  | { t: "revive"; p: PlayerId; id: number; toSub: boolean }
  | { t: "blocked"; p: PlayerId }
  | { t: "auto"; p: PlayerId; amount: number }
  | { t: "gameOver"; winner: PlayerId; reason: "kos" | "noUnits" }
) & { snap?: GameState };

export interface ChoiceRequest {
  key: string;
  /** 選ぶ場所。UI の見出しと表示（相手のハンドは @ のときだけ表を見せる）に使う */
  src: "deck" | "oppStorage" | "oppHand" | "oppSub" | "ownSub" | "ownTrash" | "ownStorage" | "ownHand";
  options: number[];
  count: number;
  op: string;
}

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string; state: GameState; events: GameEvent[] };
