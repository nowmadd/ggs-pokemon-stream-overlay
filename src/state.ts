export type Attack = { name: string; dmg?: number | null };
export type Pokemon = {
  name: string;
  hp: number;
  maxHp?: number;
  image?: string;
  tool?: string;
  // whether this Pokémon's ability has been used (UI flag)
  abilityUsed?: boolean;
  subtypes?: string[];
};
export type PlayerState = {
  name: string;
  record: string;
  deck: string;
  active: Pokemon | null;
  swappedAt?: number;
  ability?: string;
  attack?: Attack;
  attack2?: Attack;
  tool?: string;
  supporterUsed?: boolean;
  // per-player energy toggle (boolean) and retreat flag
  energy?: boolean;
  retreatUsed?: boolean;
  // timestamped use event for showing a recently used card in the overlay
  lastUsedAt?: number;
  lastUsedName?: string;
  lastUsedType?: string;
  bench?: (Pokemon | null)[];
  // prize markers: true == collected (grayscaled)
  prizes?: boolean[];
  zones: string[];
};
export type OverlayState = {
  canvas: { width: number; height: number };
  stadium: string;
  // whether to show HP bars/numbers on the overlay
  showHp?: boolean;
  // match countdown (seconds) and whether it's active
  countdown?: number;
  countdownRunning?: boolean;
  turn?: "left" | "right";
  roundLabel: string;
  timer: string;
  left: PlayerState;
  right: PlayerState;
};

export const channel = new BroadcastChannel("tcg-overlay");

export const defaultState: OverlayState = {
  canvas: { width: 1920, height: 1080 },
  stadium: "Artazon",
  roundLabel: "",
  timer: "",
  turn: "left",
  countdown: 1800 /* default 30:00 */,
  countdownRunning: false,
  left: {
    name: "",
    record: "",
    deck: "",
    active: { name: "", hp: 0, maxHp: 300 },
    supporterUsed: false,
    energy: false,
    retreatUsed: false,
    bench: [],
    prizes: [false, false, false, false, false, false],
    zones: ["", "", "", ""],
  },
  right: {
    name: "",
    record: "",
    deck: "",
    active: { name: "", hp: 0, maxHp: 300 },
    supporterUsed: false,
    energy: false,
    retreatUsed: false,
    bench: [],
    prizes: [false, false, false, false, false, false],
    zones: ["", "", "", ""],
  },
  // show HP by default
  showHp: true,
};

export function loadState(): OverlayState {
  try {
    const raw = localStorage.getItem("tcg-overlay-state");
    if (!raw) return defaultState;
    const parsed = (JSON.parse(raw) as OverlayState) || defaultState;
    // normalize player objects and ensure supporterUsed is a boolean
    parsed.left = parsed.left || defaultState.left;
    parsed.right = parsed.right || defaultState.right;
    parsed.left.supporterUsed = !!parsed.left.supporterUsed;
    parsed.right.supporterUsed = !!parsed.right.supporterUsed;
    return parsed;
  } catch {
    return defaultState;
  }
}
export function saveState(s: OverlayState) {
  try {
    localStorage.setItem("tcg-overlay-state", JSON.stringify(s));
  } catch {}
}
