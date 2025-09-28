import React, { useEffect, useState } from "react";
import {
  channel,
  loadState,
  saveState,
  OverlayState,
  defaultState,
} from "../state";
import ALL_CARDS from "../cards/allCards";

// Optional WebSocket relay for cross-origin OBS setups (best-effort).
let wsClient: WebSocket | null = null;
try {
  const hosts = [location.hostname, "localhost", "127.0.0.1"];
  for (const h of hosts) {
    try {
      // @ts-ignore runtime WebSocket
      const c = new WebSocket(`ws://${h}:8765`);
      c.addEventListener("open", () => (wsClient = c));
      c.addEventListener("error", () => {
        try {
          c.close();
        } catch {}
      });
    } catch {}
    if (wsClient) break;
  }
} catch {}

export default function Control(): JSX.Element {
  const [state, setState] = useState<OverlayState>(loadState);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [targetSide, setTargetSide] = useState<"left" | "right">("left");
  const [targetSlot, setTargetSlot] = useState<number | "active">("active");
  const [localCache, setLocalCache] = useState<any[] | null>(() => {
    try {
      const raw = localStorage.getItem("tcg-cache");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [caching, setCaching] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerRef = React.useRef<number | null>(null);
  const matchCountdownRef = React.useRef<number | null>(null);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const sendFull = (payload: OverlayState) => {
    channel.postMessage({ type: "fullState", payload });
    try {
      saveState(payload);
    } catch {}
    try {
      if (wsClient && wsClient.readyState === wsClient.OPEN)
        wsClient.send(JSON.stringify({ type: "fullState", payload }));
    } catch {}
  };

  const parseTimer = (s: string) => {
    // accept MM:SS or seconds as number
    if (!s) return 0;
    const m = s.match(/^(\d+):(\d\d)$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    const n = Number(String(s).replace(/[^0-9]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const formatTimer = (secs: number) => {
    if (!Number.isFinite(secs) || secs <= 0) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const startTimer = () => {
    if (timerRunning) return;
    let secs = parseTimer(state.timer || "");
    // if no time set, default to 5 minutes
    if (!secs) secs = 5 * 60;
    setTimerRunning(true);
    const nextState = structuredClone(state);
    nextState.timer = formatTimer(secs);
    setState(nextState);
    sendFull(nextState);
    timerRef.current = window.setInterval(() => {
      // Read the latest persisted state to avoid stale closure
      const raw = localStorage.getItem("tcg-overlay-state");
      let cur = raw ? (JSON.parse(raw) as any) : state;
      const curSecs = Number(parseTimer(cur.timer || "")) || secs;
      const nextSecs = Math.max(0, curSecs - 1);
      const sstr = formatTimer(nextSecs);
      const st: any = structuredClone(cur);
      st.timer = sstr;
      setState(st);
      sendFull(st);
      secs = nextSecs;
      if (nextSecs <= 0) {
        stopTimer();
      }
    }, 1000) as unknown as number;
    // also start match countdown: prefer the timer textbox if provided,
    // otherwise use existing countdown or default 30:00
    try {
      const fromTimer = parseTimer(state.timer || "");
      const cur = Number(state.countdown || 0);
      const matchSecs =
        fromTimer && fromTimer > 0
          ? fromTimer
          : Number.isFinite(cur) && cur > 0
          ? cur
          : 1800;
      startMatchCountdown(matchSecs);
    } catch {}
  };

  const stopTimer = () => {
    setTimerRunning(false);
    if (timerRef.current) {
      clearInterval(timerRef.current as any);
      timerRef.current = null;
    }
    // also stop the match countdown interval when timer is stopped,
    // but do not reset the countdown value — leave it (so 0 remains 0)
    if (matchCountdownRef.current) {
      clearInterval(matchCountdownRef.current as any);
      matchCountdownRef.current = null;
      const next: any = structuredClone(state);
      // leave next.countdown as-is; just mark it not running
      next.countdownRunning = false;
      setState(next);
      sendFull(next);
    }
  };

  const startMatchCountdown = (secs: number) => {
    if (matchCountdownRef.current) return;
    const next: any = structuredClone(state);
    next.countdown = secs;
    next.countdownRunning = true;
    setState(next);
    sendFull(next);
    matchCountdownRef.current = window.setInterval(() => {
      const curRaw = localStorage.getItem("tcg-overlay-state");
      let cur = curRaw ? (JSON.parse(curRaw) as any) : state;
      const curSecs = Number(cur.countdown || 0) - 1;
      const nextState: any = structuredClone(cur);
      nextState.countdown = Math.max(0, curSecs);
      nextState.countdownRunning = nextState.countdown > 0;
      setState(nextState);
      sendFull(nextState);
      if (nextState.countdown <= 0 && matchCountdownRef.current) {
        clearInterval(matchCountdownRef.current as any);
        matchCountdownRef.current = null;
        // leave the countdown at zero when finished
        const finished: any = structuredClone(nextState);
        finished.countdown = 0;
        finished.countdownRunning = false;
        setState(finished);
        sendFull(finished);
      }
    }, 1000) as unknown as number;
  };

  // stopMatchCountdown removed — countdown is controlled via startMatchCountdown

  const resetTimer = (to?: number) => {
    stopTimer();
    const secs = to ?? 0;
    const nextState: any = structuredClone(state);
    nextState.timer = formatTimer(secs);
    setState(nextState);
    sendFull(nextState);
  };

  const handleChange = (path: string, value: any) => {
    const next: any = structuredClone(state);
    const keys = path.split(".");
    let node = next;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!node[keys[i]]) node[keys[i]] = {};
      node = node[keys[i]];
    }
    const lastKey = keys[keys.length - 1];
    // special-case: if setting active HP and value <= 0, remove the active (KO)
    if (
      keys.length === 3 &&
      keys[1] === "active" &&
      lastKey === "hp" &&
      (keys[0] === "left" || keys[0] === "right")
    ) {
      const side = keys[0] as "left" | "right";
      const newHp = Number(value) || 0;
      if (newHp <= 0) {
        // remove the active Pokémon (KO)
        next[side].active = null;
        // also clear top-level ability/attacks
        next[side].ability = "";
        delete next[side].attack;
        delete next[side].attack2;
        setState(next);
        sendFull(next);
        return;
      }
      node[lastKey] = newHp;
    } else {
      node[lastKey] = value;
    }
    // If we're changing the turn, reset supporterUsed for the player who's starting their turn
    if (path === "turn") {
      try {
        const newTurn = String(value) as "left" | "right" | "";
        if (newTurn === "left" || newTurn === "right") {
          // reset the flag for the player who now has the turn
          (next as any)[newTurn] = (next as any)[newTurn] || {};
          (next as any)[newTurn].supporterUsed = false;
        } else if (newTurn === "") {
          // clearing turn: reset both
          (next as any).left = (next as any).left || {};
          (next as any).right = (next as any).right || {};
          (next as any).left.supporterUsed = false;
          (next as any).right.supporterUsed = false;
        }
      } catch {}
    }
    setState(next);
    sendFull(next);
  };

  const doSearch = (q: string) => {
    if (!q || !q.trim()) return setResults([]);
    setSearching(true);
    try {
      const source = localCache && localCache.length ? localCache : ALL_CARDS;
      const lower = q.toLowerCase();
      const matches = source.filter((c: any) =>
        (c.name || "").toLowerCase().includes(lower)
      );
      const allowed = ["G", "H", "I"];
      // prefer sets in this order when showing results
      // include the point-5 releases (sv4pt5 / sv4_5) and prefer them before sv3/sv4
      const preferredSets = ["sv10", "sv4pt5", "sv4_5", "sv4", "sv3"];
      const getSetCode = (c: any) => {
        // try common fields, fallback to id prefix
        const id = (c.set && (c.set.id || c.set.code)) || c.id || "";
        const parts = String(id || "")
          .toLowerCase()
          .split(/[^a-z0-9]+/);
        return parts[0] || "";
      };
      const parseNumber = (c: any) => {
        const n = c.number ? String(c.number).replace(/[^0-9]/g, "") : "";
        return n ? Number(n) : NaN;
      };

      const filtered = matches.filter((c: any) =>
        allowed.includes((c.regulationMark || "").toUpperCase())
      );
      filtered.sort((a: any, b: any) => {
        const aSet = getSetCode(a);
        const bSet = getSetCode(b);
        const aIdx = preferredSets.indexOf(aSet);
        const bIdx = preferredSets.indexOf(bSet);
        const aPri = aIdx === -1 ? preferredSets.length : aIdx;
        const bPri = bIdx === -1 ? preferredSets.length : bIdx;
        if (aPri !== bPri) return aPri - bPri;
        // same priority: sort by card number descending (latest first)
        const an = parseNumber(a);
        const bn = parseNumber(b);
        if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn)
          return bn - an;
        // fallback to id comparison (reverse) so newer ids appear first
        return String(b.id || "").localeCompare(String(a.id || ""));
      });
      setResults(filtered);
    } catch (e) {
      console.error("search error", e);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const parseHp = (raw: any) => {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
    if (!raw) return 0;
    const digits = String(raw).replace(/[^0-9]/g, "");
    const p = Number(digits);
    return Number.isFinite(p) ? p : 0;
  };

  // Helper: determine if a given side has any 'tera' subtype (active or bench)
  const sideHasTera = (side: "left" | "right") => {
    try {
      const player = (state as any)[side] || {};
      const checkCardForTera = (card: any) => {
        if (!card) return false;
        try {
          const subs = (card.subtypes || []).map((s: any) =>
            String(s).toLowerCase()
          );
          if (subs.includes("tera")) return true;
        } catch {}
        // fallback: try lookup by name in ALL_CARDS
        if (card.name) {
          const found = ALL_CARDS.find(
            (c: any) =>
              String(c.name || "").toLowerCase() ===
              String(card.name).toLowerCase()
          );
          if (
            found &&
            Array.isArray(found.subtypes) &&
            found.subtypes
              .map((s: any) => String(s).toLowerCase())
              .includes("tera")
          )
            return true;
        }
        return false;
      };
      if (checkCardForTera(player.active)) return true;
      const bench = player.bench || [];
      for (let i = 0; i < bench.length; i++)
        if (checkCardForTera(bench[i])) return true;
    } catch {}
    return false;
  };

  // Helper: compute desired bench indexes for a side (base 5, stadium override to 8 if enabled and side has tera)
  const desiredBenchIndexesFor = (side: "left" | "right") => {
    const baseSlots = 5;
    const stadiumMap: Record<string, number> = { "area zero underdepths": 8 };
    const stadiumKey = String(state.stadium || "").toLowerCase();
    const stadiumSlots = Object.keys(stadiumMap).find((k) =>
      stadiumKey.includes(k)
    )
      ? stadiumMap[
          Object.keys(stadiumMap).find((k) => stadiumKey.includes(k)) as string
        ]
      : 0;
    const enabled = stadiumSlots && sideHasTera(side) ? stadiumSlots : 0;
    const benchLen = ((state as any)[side]?.bench || []).length || 0;
    const desired =
      enabled > 0 ? Math.max(baseSlots, enabled, benchLen) : baseSlots;
    return Array.from({ length: desired }, (_v, i) => i);
  };

  const setActiveFromCard = (side: "left" | "right", card: any) => {
    const next: any = structuredClone(state);
    const name = card.name || "";
    const hp = parseHp(card.hp) || 0;
    const img = card.images?.large || card.images?.small || "";
    const ability =
      card.abilities && card.abilities[0]
        ? card.abilities[0].name || card.abilities[0].text || ""
        : "";
    let attack1: any = undefined;
    let attack2: any = undefined;
    if (card.attacks && card.attacks[0]) {
      const a = card.attacks[0];
      const dmg = a.damage
        ? Number(String(a.damage).replace(/[^0-9]/g, ""))
        : NaN;
      attack1 = {
        name: a.name || "",
        dmg: Number.isFinite(dmg) ? dmg : undefined,
      };
    }
    if (!ability && card.attacks && card.attacks[1]) {
      const a = card.attacks[1];
      const dmg = a.damage
        ? Number(String(a.damage).replace(/[^0-9]/g, ""))
        : NaN;
      attack2 = {
        name: a.name || "",
        dmg: Number.isFinite(dmg) ? dmg : undefined,
      };
    }
    next[side].active = {
      name,
      hp,
      maxHp: hp || 300,
      image: img,
      subtypes: card.subtypes || undefined,
      // imageScale/imagePos may be set at swap time to preserve bench transform
    };
    next[side].ability = ability || "";
    if (attack1) next[side].attack = attack1;
    else delete next[side].attack;
    if (attack2) next[side].attack2 = attack2;
    else delete next[side].attack2;
    setState(next);
    sendFull(next);
  };

  const setBenchFromCard = (side: "left" | "right", idx: number, card: any) => {
    const next: any = structuredClone(state);
    const name = card.name || "";
    const hp = parseHp(card.hp) || 0;
    const img = card.images?.large || card.images?.small || "";
    // also capture ability + attacks so bench display can show them
    const ability =
      card.abilities && card.abilities[0]
        ? card.abilities[0].name || card.abilities[0].text || ""
        : "";
    let attack1: any = undefined;
    let attack2: any = undefined;
    if (card.attacks && card.attacks[0]) {
      const a = card.attacks[0];
      const dmg = a.damage
        ? Number(String(a.damage).replace(/[^0-9]/g, ""))
        : NaN;
      attack1 = {
        name: a.name || "",
        dmg: Number.isFinite(dmg) ? dmg : undefined,
        cost: a.cost || a.costs,
      };
    }
    if (card.attacks && card.attacks[1]) {
      const a = card.attacks[1];
      const dmg = a.damage
        ? Number(String(a.damage).replace(/[^0-9]/g, ""))
        : NaN;
      attack2 = {
        name: a.name || "",
        dmg: Number.isFinite(dmg) ? dmg : undefined,
        cost: a.cost || a.costs,
      };
    }
    next[side].bench = next[side].bench || [];
    // compute thumbnail transform metadata to preserve visual appearance
    const computeThumbScalePosFromSubtypes = (subtypes: string[] = []) => {
      const subs = (subtypes || []).map((s) => String(s).toLowerCase());
      let scale = 1.1;
      let pos = "0px -20px";
      if (subs.includes("stage 2") || subs.includes("stage2")) {
        scale = 1.2;
        pos = "0px -10px";
      }
      if (subs.includes("tera")) {
        scale = 1.2;
        pos = "0px -18px";
      } else if (subs.includes("stage 1") || subs.includes("stage1")) {
        scale = 1.25;
        pos = "0px -10px";
      } else if (subs.includes("basic")) {
        scale = 1.2;
        pos = "0px -10px";
      }
      return { scale, pos };
    };

    // determine subtypes for the card (fallback lookup)
    let subs: string[] = [];
    try {
      if (card.subtypes && (card.subtypes || []).length)
        subs = (card.subtypes || []).map((s: any) => String(s).toLowerCase());
      else if (name) {
        const found = ALL_CARDS.find(
          (c: any) =>
            String(c.name || "").toLowerCase() === String(name).toLowerCase()
        );
        if (found && found.subtypes)
          subs = (found.subtypes || []).map((s: any) =>
            String(s).toLowerCase()
          );
      }
    } catch {}
    const { scale: thumbScale, pos: thumbPos } =
      computeThumbScalePosFromSubtypes(subs);

    next[side].bench[idx] = {
      name,
      hp,
      maxHp: hp || undefined,
      image: img,
      ability: ability || undefined,
      attack: attack1,
      attack2: attack2,
      // store thumbnail transform metadata
      thumbScale,
      thumbPos,
      subtypes: card.subtypes || undefined,
    };
    setState(next);
    sendFull(next);
  };

  const swapActiveWithBench = (side: "left" | "right", idx: number) => {
    const next: any = structuredClone(state);
    next[side].bench = next[side].bench || [];
    const activeObj: any = next[side].active || {
      name: "",
      hp: 0,
      maxHp: 300,
      image: "",
    };
    const benchObj: any = next[side].bench[idx] || {
      name: "",
      hp: 0,
      maxHp: undefined,
      image: "",
    };

    // capture metadata broadly so we retain arbitrary fields
    const activeMeta: any = {
      ...activeObj,
      ability: next[side].ability,
      attack: next[side].attack,
      attack2: next[side].attack2,
    };

    // normalize bench ability/attacks from multiple possible shapes
    const normalizeBenchAbility = (b: any) => {
      if (!b) return null;
      if (b.ability && String(b.ability).trim() !== "") return b.ability;
      if (b.abilities && b.abilities[0])
        return (
          b.abilities[0].name ||
          b.abilities[0].text ||
          b.abilities[0].ability ||
          null
        );
      return null;
    };
    const normalizeBenchAttack = (a: any) => {
      if (!a) return null;
      // already normalized shape
      if (a.name) return a;
      // possible shapes: attacks array, attack1/attack_1, attack2
      if (a.attacks && a.attacks[0]) {
        const t = a.attacks[0];
        const dmg = t.damage
          ? Number(String(t.damage).replace(/[^0-9]/g, ""))
          : NaN;
        return {
          name: t.name || "",
          dmg: Number.isFinite(dmg) ? dmg : undefined,
          cost: t.cost || t.costs,
        };
      }
      if (a.attack1) return a.attack1;
      if (a.attack_1) return a.attack_1;
      return null;
    };

    const benchMeta: any = {
      ...benchObj,
      ability: normalizeBenchAbility(benchObj),
      attack:
        benchObj.attack ||
        (benchObj.attacks && benchObj.attacks[0]) ||
        benchObj.attack1 ||
        benchObj.attack_1 ||
        benchObj.attack ||
        null,
      attack2:
        benchObj.attack2 ||
        (benchObj.attacks && benchObj.attacks[1]) ||
        benchObj.attack2 ||
        benchObj.attack_2 ||
        benchObj.attack1_2 ||
        null,
    };

    // move active into bench slot (preserve all active fields)
    // when moving active into bench, compute and store thumb transform for that bench slot
    const computeThumbScalePosFromSubtypes = (subtypes: string[] = []) => {
      const subs = (subtypes || []).map((s) => String(s).toLowerCase());
      let scale = 1.1;
      let pos = "0px -20px";
      if (subs.includes("stage 2") || subs.includes("stage2")) {
        scale = 1.2;
        pos = "0px -10px";
      }
      if (subs.includes("tera")) {
        scale = 1.2;
        pos = "0px -18px";
      } else if (subs.includes("stage 1") || subs.includes("stage1")) {
        scale = 1.25;
        pos = "0px -10px";
      } else if (subs.includes("basic")) {
        scale = 1.2;
        pos = "0px -10px";
      }
      return { scale, pos };
    };
    const activeSubs = (activeObj.subtypes || []) as string[];
    const { scale: activeThumbScale, pos: activeThumbPos } =
      computeThumbScalePosFromSubtypes(activeSubs);
    next[side].bench[idx] = {
      ...activeMeta,
      name: activeObj.name || "",
      hp: activeObj.hp || 0,
      maxHp: activeObj.maxHp ?? activeObj.hp ?? 300,
      image: activeObj.image || "",
      // preserve thumb metadata for bench
      thumbScale: activeThumbScale,
      thumbPos: activeThumbPos,
      subtypes: activeObj.subtypes || undefined,
    };

    // move bench slot into active (preserve bench fields)
    // If the bench slot is empty (null/undefined or has no name/image), then
    // moving it into active should clear the active slot (set to null).
    const benchIsEmpty =
      !benchObj || (!benchObj.name && !benchObj.image && !(benchObj.hp > 0));
    if (benchIsEmpty) {
      // Empty bench -> active becomes null, clear top-level ability/attacks
      next[side].active = null;
      next[side].ability = "";
      delete next[side].attack;
      delete next[side].attack2;
    } else {
      // move bench slot into active (preserve bench fields).
      // If the bench slot has thumbnail transform metadata (thumbScale/thumbPos) or
      // imageScale/imagePos, copy them into the active slot as imageScale/imagePos so
      // the visual transform remains identical on swap.
      const benchThumbScale = (benchObj as any)?.thumbScale;
      const benchThumbPos = (benchObj as any)?.thumbPos;
      const benchImageScale = (benchObj as any)?.imageScale;
      const benchImagePos = (benchObj as any)?.imagePos;
      const activeImageScale = benchImageScale ?? benchThumbScale ?? undefined;
      const activeImagePos = benchImagePos ?? benchThumbPos ?? undefined;
      const activeObj: any = {
        name: benchObj.name || "",
        hp: benchObj.hp || 0,
        maxHp: benchObj.maxHp ?? benchObj.hp ?? 300,
        image: benchObj.image || "",
        subtypes: benchObj.subtypes || undefined,
      };
      if (activeImageScale !== undefined)
        activeObj.imageScale = activeImageScale;
      if (activeImagePos !== undefined) activeObj.imagePos = activeImagePos;
      next[side].active = activeObj;
    }
    // mark when the swap occurred so UI can animate/adjust image transform
    next[side].swappedAt = Date.now();

    // set top-level ability/attacks from bench entry if present (normalize shapes)
    next[side].ability = benchMeta.ability || "";
    // normalize attack objects to {name,dmg} where possible
    const normalizeToAttackObj = (raw: any) => {
      if (!raw) return undefined;
      if (raw.name)
        return {
          name: raw.name || "",
          dmg: raw.dmg ?? raw.damage ?? raw.amount ?? undefined,
          cost: raw.cost || raw.costs,
        };
      if (raw.name === undefined && raw.name !== null) return undefined;
      try {
        const t = raw as any;
        if (t.name)
          return {
            name: t.name || "",
            dmg: t.dmg ?? t.damage ?? undefined,
            cost: t.cost || t.costs,
          };
      } catch {}
      return undefined;
    };

    const normA = normalizeToAttackObj(benchMeta.attack);
    const normA2 = normalizeToAttackObj(benchMeta.attack2);
    if (normA) next[side].attack = normA;
    else delete next[side].attack;
    if (normA2) next[side].attack2 = normA2;
    else delete next[side].attack2;

    setState(next);
    sendFull(next);
  };

  const applyUtility = (card: any) => {
    const eff = (state.turn as "left" | "right") || targetSide;
    const subs = (card.subtypes || []).map((s: any) => String(s).toLowerCase());
    const next: any = structuredClone(state);
    const now = Date.now();
    if (subs.includes("stadium")) next.stadium = card.name || "";
    if (subs.includes("item") || subs.includes("tool")) {
      if (next[eff].active) next[eff].active.tool = card.name || "";
      else next[eff].tool = card.name || "";
    }
    // Enforce once-per-turn for Supporters: if already used, do nothing
    if (subs.includes("supporter")) {
      if (next[eff].supporterUsed) {
        // already used this turn for that side — ignore
        return;
      }
      next[eff].supporterUsed = true;
    }
    // record explicit use so overlay knows this was an intentional click
    next[eff].lastUsedAt = now;
    next[eff].lastUsedName = card.name || "";
    next[eff].lastUsedType = subs.includes("supporter")
      ? "supporter"
      : subs.includes("stadium")
      ? "stadium"
      : subs.includes("item")
      ? "item"
      : subs.includes("tool")
      ? "tool"
      : "";
    setState(next);
    sendFull(next);
  };

  const swapSides = () => {
    const next: any = { ...state, left: state.right, right: state.left };
    setState(next);
    sendFull(next);
  };

  // Apply an evolution card to a target slot. slot can be 'active' or bench index (0..4).
  const applyEvolution = (
    side: "left" | "right",
    slot: "active" | number,
    card: any
  ) => {
    const next: any = structuredClone(state);
    const name = card.name || "";
    const img = card.images?.large || card.images?.small || "";
    // When evolving, preserve current HP of the target if present.
    if (slot === "active") {
      const cur = next[side].active;
      if (!cur) return; // nothing to evolve
      const oldHp = Number(cur.hp || 0) || 0;
      const oldMax = Number(cur.maxHp || cur.hp || 300) || 300;
      const damage = Math.max(0, oldMax - oldHp);
      // determine new maxHp from card if provided, otherwise keep old max
      const parsedNewMax = card.hp
        ? parseInt(String(card.hp).replace(/[^0-9]/g, "")) || undefined
        : undefined;
      const newMax = parsedNewMax ?? oldMax ?? 300;
      const newHp = Math.max(0, newMax - damage);
      next[side].active = {
        name,
        hp: newHp,
        maxHp: newMax,
        image: img,
        subtypes: card.subtypes || undefined,
      };
      // top-level ability/attacks updated from the new card
      next[side].ability =
        (card.abilities &&
          card.abilities[0] &&
          (card.abilities[0].name || card.abilities[0].text)) ||
        "";
      if (card.attacks && card.attacks[0]) {
        const a = card.attacks[0];
        const dmg = a.damage
          ? Number(String(a.damage).replace(/[^0-9]/g, ""))
          : NaN;
        next[side].attack = {
          name: a.name || "",
          dmg: Number.isFinite(dmg) ? dmg : undefined,
        };
      } else delete next[side].attack;
      if (card.attacks && card.attacks[1]) {
        const a = card.attacks[1];
        const dmg = a.damage
          ? Number(String(a.damage).replace(/[^0-9]/g, ""))
          : NaN;
        next[side].attack2 = {
          name: a.name || "",
          dmg: Number.isFinite(dmg) ? dmg : undefined,
        };
      } else delete next[side].attack2;
    } else {
      // bench slot
      next[side].bench = next[side].bench || [];
      const cur = next[side].bench[slot as number];
      if (!cur) return; // nothing to evolve
      const oldHp = Number(cur.hp || 0) || 0;
      const oldMax = Number(cur.maxHp || cur.hp || 0) || 0;
      const damage = Math.max(0, oldMax - oldHp);
      const parsedNewMax = card.hp
        ? parseInt(String(card.hp).replace(/[^0-9]/g, "")) || undefined
        : undefined;
      const newMax = parsedNewMax ?? oldMax ?? undefined;
      const newHp = newMax !== undefined ? Math.max(0, newMax - damage) : oldHp;
      // extract ability/attacks from the evolution card so bench slot shows them
      const ability =
        card.abilities && card.abilities[0]
          ? card.abilities[0].name || card.abilities[0].text || ""
          : "";
      let attack1: any = undefined;
      let attack2: any = undefined;
      if (card.attacks && card.attacks[0]) {
        const a = card.attacks[0];
        const dmg = a.damage
          ? Number(String(a.damage).replace(/[^0-9]/g, ""))
          : NaN;
        attack1 = {
          name: a.name || "",
          dmg: Number.isFinite(dmg) ? dmg : undefined,
          cost: a.cost || a.costs,
        };
      }
      if (card.attacks && card.attacks[1]) {
        const a = card.attacks[1];
        const dmg = a.damage
          ? Number(String(a.damage).replace(/[^0-9]/g, ""))
          : NaN;
        attack2 = {
          name: a.name || "",
          dmg: Number.isFinite(dmg) ? dmg : undefined,
          cost: a.cost || a.costs,
        };
      }

      next[side].bench[slot as number] = {
        name,
        hp: newHp,
        maxHp: newMax ?? cur.maxHp ?? undefined,
        image: img,
        subtypes: card.subtypes || undefined,
        // include ability/attacks so the bench UI can render them like when adding a card
        ...(ability ? { ability } : {}),
        ...(attack1 ? { attack: attack1 } : {}),
        ...(attack2 ? { attack2: attack2 } : {}),
      };
    }
    setState(next);
    sendFull(next);
    return next;
  };

  // Normalize card names for fuzzy matching: remove punctuation, common suffixes (ex, v, vmax), and whitespace.
  const normalizeName = (s?: string) => {
    if (!s) return "";
    return (
      String(s)
        .toLowerCase()
        // remove common suffix tokens that appear in variants
        .replace(/\b(ex|vmax|v|max|gx|full ?art|promo)\b/g, "")
        // remove non-alphanumeric
        .replace(/[^a-z0-9]/g, "")
        .trim()
    );
  };

  // Build a fast index mapping base normalized name -> array of candidate higher-evolution cards.
  // Computed once to avoid repeated expensive scans during render.
  const evolutionIndex = React.useMemo(() => {
    const map = new Map<string, any[]>();
    const findByName = (n: string) =>
      ALL_CARDS.find((c: any) => normalizeName(c.name) === normalizeName(n));
    for (const card of ALL_CARDS) {
      try {
        // Walk up the evolvesFrom chain for this card and register this card under each ancestor name
        let cur: any = card;
        const seen = new Set<string>();
        for (let depth = 0; depth < 10 && cur; depth++) {
          const parent = String(cur.evolvesFrom || cur.evolveFrom || "").trim();
          if (!parent) break;
          const key = normalizeName(parent);
          if (!key) break;
          if (!map.has(key)) map.set(key, []);
          // avoid duplicates
          if (!seen.has(card.name)) {
            map.get(key)!.push(card);
            seen.add(card.name);
          }
          cur = findByName(parent);
          if (!cur) break;
        }
      } catch {}
    }
    return map;
  }, [] as any[]);
  // map normalized name -> card for fast lookups
  const nameMap = React.useMemo(() => {
    const m = new Map<string, any>();
    for (const c of ALL_CARDS) {
      try {
        const k = normalizeName(c.name);
        if (k && !m.has(k)) m.set(k, c);
      } catch {}
    }
    return m;
  }, []);

  // simple cache to memoize fallback candidate scans per base name
  const candidateCacheRef = React.useRef<Map<string, any[]>>(new Map());

  const getCandidatesForBase = (baseName?: string) => {
    if (!baseName) return [] as any[];
    const baseNorm = normalizeName(baseName);
    const direct = evolutionIndex.get(baseNorm) || [];
    if (direct && direct.length) return Array.from(new Set(direct));
    // fallback: scan all bundled cards and check ancestry directly (more tolerant)
    // but memoize results per base to avoid repeated expensive scans
    const cached = candidateCacheRef.current.get(baseNorm);
    if (cached) return cached;
    const out: any[] = [];
    for (const cand of ALL_CARDS) {
      try {
        if (candidateHasBaseAncestor(cand, baseName)) out.push(cand);
      } catch {}
    }
    // dedupe by normalized name
    const seen = new Set<string>();
    const deduped = out.filter((c) => {
      const n = normalizeName(c?.name || "");
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    candidateCacheRef.current.set(baseNorm, deduped);
    return deduped;
  };

  // compute distance (number of evolvesFrom steps) from candidateCard up to baseName
  const evolutionDistanceToBase = (candidateCard: any, baseName?: string) => {
    if (!candidateCard || !baseName) return -1;
    const baseNorm = normalizeName(baseName);
    // First, try walking up via evolvesFrom chain (child -> parent)
    let cur: any = candidateCard;
    let steps = 0;
    const maxDepth = 10;
    for (let i = 0; i < maxDepth && cur; i++) {
      const parentName = String(cur.evolvesFrom || cur.evolveFrom || "").trim();
      if (!parentName) break;
      steps++;
      if (normalizeName(parentName) === baseNorm) return steps;
      cur = nameMap.get(normalizeName(parentName)) || null;
      if (!cur) break;
    }

    // If not found by walking up, try walking forward from the base via evolvesTo chains (base -> child)
    try {
      const start = nameMap.get(normalizeName(baseName));
      if (!start) return -1;
      const targetNorm = normalizeName(candidateCard.name || "");
      const visited = new Set<string>();
      const q: Array<{ node: any; depth: number }> = [
        { node: start, depth: 0 },
      ];
      while (q.length) {
        const { node, depth } = q.shift() as any;
        const nodeNorm = normalizeName(node.name || "");
        if (visited.has(nodeNorm)) continue;
        visited.add(nodeNorm);
        const children = node.evolvesTo || node.evolvesTo || [];
        for (const childName of children) {
          const child = nameMap.get(normalizeName(String(childName || "")));
          if (!child) continue;
          const childNorm = normalizeName(child.name || "");
          if (childNorm === targetNorm) return depth + 1;
          if (!visited.has(childNorm))
            q.push({ node: child, depth: depth + 1 });
        }
      }
    } catch {}

    return -1;
  };

  // Rare Candy candidates: exactly two steps above the base (skip stage 1)
  const getRareCandyCandidates = (baseName?: string) => {
    if (!baseName) return [] as any[];
    const all = getCandidatesForBase(baseName);
    const res: any[] = [];
    for (const c of all) {
      try {
        const d = evolutionDistanceToBase(c, baseName);
        if (d === 2) res.push(c);
      } catch {}
    }
    return res;
  };

  // Find a card in the bundled list by normalized name
  const findCardByName = (name?: string) => {
    if (!name) return null;
    const target = normalizeName(name);
    return ALL_CARDS.find((c: any) => normalizeName(c.name) === target) || null;
  };

  // Walk the evolvesFrom chain upwards to see if candidateCard descends from baseName
  const candidateHasBaseAncestor = (candidateCard: any, baseName?: string) => {
    if (!candidateCard || !baseName) return false;
    return evolutionDistanceToBase(candidateCard, baseName) > 0;
  };

  // Find all cards that are a higher evolution of baseName (i.e. chain contains baseName)
  const findAllHigherEvolutions = (baseName?: string) => {
    return getCandidatesForBase(baseName);
  };

  // List eligible slots (active or bench indexes) on a side that have a base Pokémon with higher evolutions
  const listEligibleSlotsForSide = (side: "left" | "right") => {
    const slots: Array<{ slot: "active" | number; name: string }> = [];
    const active = state[side].active;
    if (active && active.name && getRareCandyCandidates(active.name).length) {
      slots.push({ slot: "active", name: active.name });
    }
    const bench = (state as any)[side].bench || [];
    for (let i = 0; i < 5; i++) {
      const b = bench[i];
      if (b && b.name && getRareCandyCandidates(b.name).length) {
        slots.push({ slot: i, name: b.name });
      }
    }
    return slots;
  };

  // Use Rare Candy: choose target slot (if multiple) then choose final evolution (if multiple) and apply
  const useRareCandy = (side: "left" | "right", card: any) => {
    const eligible = listEligibleSlotsForSide(side);
    if (!eligible || eligible.length === 0) {
      window.alert("No eligible Pokémon to Rare Candy on that side.");
      return;
    }
    let chosenSlot: "active" | number = eligible[0].slot;
    if (eligible.length > 1) {
      const promptText = eligible
        .map(
          (s, i) =>
            `${i + 1}: ${
              s.slot === "active" ? "Active" : "Bench " + (s.slot + 1)
            } (${s.name})`
        )
        .join("\n");
      const pick = window.prompt(
        "Choose slot to Rare Candy:\n" + promptText + "\nEnter number:"
      );
      const idx = Number(pick) - 1;
      if (!Number.isFinite(idx) || idx < 0 || idx >= eligible.length) return;
      chosenSlot = eligible[idx].slot;
    }

    const baseName =
      chosenSlot === "active"
        ? state[side].active?.name
        : (state as any)[side].bench?.[chosenSlot]?.name;
    if (!baseName) return;
    const candidates = getRareCandyCandidates(baseName);
    if (!candidates || candidates.length === 0) {
      window.alert("No higher evolutions found for " + baseName);
      return;
    }
    let chosenCard = candidates[0];
    if (candidates.length > 1) {
      const promptText = candidates
        .map((c: any, i: number) => `${i + 1}: ${c.name}`)
        .join("\n");
      const pick = window.prompt(
        "Choose evolution:\n" + promptText + "\nEnter number:"
      );
      const idx = Number(pick) - 1;
      if (!Number.isFinite(idx) || idx < 0 || idx >= candidates.length) return;
      chosenCard = candidates[idx];
    }

    // apply the evolution and mark Rare Candy as used using the returned state
    try {
      const newState = applyEvolution(side, chosenSlot, chosenCard) || state;
      newState[side] = newState[side] || {};
      newState[side].lastUsedAt = Date.now();
      newState[side].lastUsedName = card.name || "Rare Candy";
      newState[side].lastUsedType = "item";
      setState(newState);
      sendFull(newState);
    } catch {}
  };

  // Apply Rare Candy to a specific slot (clicked from the inline slot buttons).
  const useRareCandyOnSlot = (
    side: "left" | "right",
    slot: "active" | number,
    card: any
  ) => {
    const baseName =
      slot === "active"
        ? state[side].active?.name
        : (state as any)[side].bench?.[slot as number]?.name;
    if (!baseName) return;
    const candidates = getRareCandyCandidates(baseName);
    if (!candidates || candidates.length === 0) {
      window.alert("No higher evolutions found for " + baseName);
      return;
    }
    if (candidates.length === 1) {
      try {
        const newState = applyEvolution(side, slot, candidates[0]) || state;
        newState[side] = newState[side] || {};
        newState[side].lastUsedAt = Date.now();
        newState[side].lastUsedName = card.name || "Rare Candy";
        newState[side].lastUsedType = "item";
        setState(newState);
        sendFull(newState);
      } catch {}
      return;
    }
    const promptText = candidates
      .map((c: any, i: number) => `${i + 1}: ${c.name}`)
      .join("\n");
    const pick = window.prompt(
      "Choose evolution:\n" + promptText + "\nEnter number:"
    );
    const idx = Number(pick) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= candidates.length) return;
    try {
      const newState = applyEvolution(side, slot, candidates[idx]) || state;
      newState[side] = newState[side] || {};
      newState[side].lastUsedAt = Date.now();
      newState[side].lastUsedName = card.name || "Rare Candy";
      newState[side].lastUsedType = "item";
      setState(newState);
      sendFull(newState);
    } catch {}
  };
  const resetZones = () => {
    const next: any = structuredClone(state);
    next.left.zones = ["", "", "", ""];
    next.right.zones = ["", "", "", ""];
    setState(next);
    sendFull(next);
  };

  // Clear / reset the entire board (players, benches, actives, timers, stadium, metadata)
  const clearBoard = () => {
    if (
      !window.confirm(
        "Clear the board? This will remove all player data, benches, timers and stadium."
      )
    )
      return;
    const next: any = structuredClone(defaultState);
    // Preserve canvas dimensions from current state
    try {
      next.canvas = state.canvas || next.canvas;
    } catch {}
    // Explicitly clear stadium and timers
    next.stadium = "";
    next.timer = "";
    next.countdown = 0;
    next.countdownRunning = false;

    // Ensure players are empty with predictable bench length (5 slots)
    const makeEmptyPlayer = () => ({
      name: "",
      record: "",
      deck: "",
      active: null,
      supporterUsed: false,
      // create fresh arrays for each player so references are not shared
      bench: [null, null, null, null, null],
      zones: ["", "", "", ""],
    });
    next.left = makeEmptyPlayer();
    next.right = makeEmptyPlayer();

    setState(next);
    sendFull(next);
  };

  const toggleFullscreen = () => {
    try {
      if (!document.fullscreenElement)
        document.documentElement.requestFullscreen()?.catch(() => {});
      else document.exitFullscreen()?.catch(() => {});
    } catch {}
  };

  const syncCache = () => {
    setCaching(true);
    try {
      const allowed = ["G", "H", "I"];
      const all = ALL_CARDS.filter((c: any) =>
        allowed.includes((c.regulationMark || "").toUpperCase())
      );
      localStorage.setItem("tcg-cache", JSON.stringify(all));
      setLocalCache(all);
    } catch (e) {
      console.error(e);
    }
    setCaching(false);
  };

  return (
    <div className="control-wrap">
      <h2>TCG OBS Overlay — Control</h2>
      <p className="muted">
        Open <b>#/overlay</b> in a separate window (or OBS browser source).
        Edits here update the overlay instantly.
      </p>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row">
          <label>Canvas Size</label>
          <input
            type="number"
            value={state.canvas.width}
            onChange={(e) =>
              handleChange("canvas.width", Number(e.target.value))
            }
          />
          <input
            type="number"
            value={state.canvas.height}
            onChange={(e) =>
              handleChange("canvas.height", Number(e.target.value))
            }
          />
        </div>
        <div className="row">
          <label>Stadium</label>
          <input
            value={state.stadium}
            onChange={(e) => handleChange("stadium", e.target.value)}
          />
          <button
            className="btn"
            onClick={() => {
              const next: any = structuredClone(state);
              next.stadium = "";
              // clear any lastUsed references that point to this stadium
              try {
                if (next.left?.lastUsedName === state.stadium) {
                  next.left.lastUsedName = "";
                  next.left.lastUsedType = "";
                  next.left.lastUsedAt = 0;
                }
                if (next.right?.lastUsedName === state.stadium) {
                  next.right.lastUsedName = "";
                  next.right.lastUsedType = "";
                  next.right.lastUsedAt = 0;
                }
              } catch {}
              setState(next);
              sendFull(next);
            }}
          >
            Remove
          </button>
        </div>
        <div className="row">
          <label>Turn</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className={"btn" + (state.turn === "left" ? " active" : "")}
              onClick={() => handleChange("turn", "left")}
            >
              Left
            </button>
            <button
              className={"btn" + (state.turn === "right" ? " active" : "")}
              onClick={() => handleChange("turn", "right")}
            >
              Right
            </button>
            <button
              className="btn"
              onClick={() => {
                const next: any = structuredClone(state);
                next.left = next.left || {};
                next.right = next.right || {};
                next.left.supporterUsed = false;
                next.right.supporterUsed = false;
                setState(next);
                sendFull(next);
              }}
            >
              Reset Supporters
            </button>
            <button className="btn" onClick={() => handleChange("turn", "")}>
              Clear
            </button>
          </div>
        </div>
        <div className="row">
          <label>Round</label>
          <div style={{ display: "flex", gap: 8 }}>
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                className={
                  "btn round-btn" +
                  (state.roundLabel === `Round ${n}` ? " active" : "")
                }
                onClick={() => handleChange("roundLabel", `Round ${n}`)}
              >
                {`Round ${n}`}
              </button>
            ))}
            <button
              className="btn"
              onClick={() => handleChange("roundLabel", "")}
            >
              Clear
            </button>
          </div>
        </div>
        <div className="row">
          <label>Timer</label>
          <input
            value={state.timer}
            onChange={(e) => handleChange("timer", e.target.value)}
          />
          <button
            className="btn"
            onClick={() => (timerRunning ? stopTimer() : startTimer())}
          >
            {timerRunning ? "Stop" : "Start"}
          </button>
          <button
            className="btn"
            onClick={() => {
              resetTimer(parseTimer(state.timer || "") || 0);
              const next: any = structuredClone(state);
              next.countdown = 1800; // reset match countdown to 30:00
              next.countdownRunning = false;
              setState(next);
              sendFull(next);
            }}
          >
            Reset
          </button>
          {/* match countdown input and manual start removed; use Reset to set 30:00 and Start to begin simple timer */}
        </div>
        <div className="btn-bar">
          <button className="btn" onClick={swapSides}>
            Swap Sides
          </button>
          <button className="btn" onClick={resetZones}>
            Clear Zones
          </button>
          <button
            className="btn"
            onClick={clearBoard}
            style={{ background: "#a00", color: "#fff" }}
          >
            Clear Board
          </button>
        </div>
      </div>

      <div className="grid-2">
        <div
          className={
            "card" +
            ((state.turn as "left" | "right") === "left" ? " turn" : "")
          }
        >
          <h3>Left Player</h3>
          <div className="row">
            <label>Name</label>
            <input
              value={state.left.name}
              onChange={(e) => handleChange("left.name", e.target.value)}
            />
          </div>
          <div className="row">
            <label>Record</label>
            <input
              value={state.left.record}
              onChange={(e) => handleChange("left.record", e.target.value)}
            />
          </div>
          <div className="row">
            <label>Deck</label>
            <input
              value={state.left.deck}
              onChange={(e) => handleChange("left.deck", e.target.value)}
            />
          </div>
          <div className="row">
            <label>Active Name</label>
            <input
              value={state.left.active?.name || ""}
              onChange={(e) => handleChange("left.active.name", e.target.value)}
            />
          </div>
          <div className="row">
            <label>Active HP</label>
            <input
              type="number"
              value={state.left.active?.hp ?? 0}
              onChange={(e) =>
                handleChange("left.active.hp", Number(e.target.value))
              }
            />
            <input
              type="number"
              id={`dec-left-active`}
              placeholder="Dec"
              style={{ width: 80, marginLeft: 8 }}
            />
            <input
              type="number"
              id={`inc-left-active`}
              placeholder="Inc"
              style={{ width: 80, marginLeft: 8 }}
            />
            <button
              className="btn"
              onClick={() => {
                const decEl = document.getElementById(
                  `dec-left-active`
                ) as HTMLInputElement | null;
                const incEl = document.getElementById(
                  `inc-left-active`
                ) as HTMLInputElement | null;
                const dec = Number(decEl?.value) || 0;
                const inc = Number(incEl?.value) || 0;
                const delta = inc - dec;
                if (!delta) return;
                const next: any = structuredClone(state);
                next.left.active = next.left.active ?? {
                  name: "",
                  hp: 0,
                  maxHp: 300,
                  image: "",
                };
                // coerce numeric hp safely
                const curHp = Number(next.left.active.hp ?? 0) || 0;
                next.left.active.hp = Math.max(0, curHp + delta);
                if ((next.left.active.hp || 0) <= 0) {
                  // remove active on KO
                  next.left.active = null;
                  next.left.ability = "";
                  delete next.left.attack;
                  delete next.left.attack2;
                }
                setState(next);
                sendFull(next);
                if (decEl) decEl.value = "";
                if (incEl) incEl.value = "";
              }}
              style={{ marginLeft: 8 }}
            >
              Confirm
            </button>
            <button
              className="btn"
              onClick={() => {
                const next: any = structuredClone(state);
                // remove active on KO
                next.left.active = null;
                next.left.ability = "";
                delete next.left.attack;
                delete next.left.attack2;
                setState(next);
                sendFull(next);
              }}
              style={{ marginLeft: 8 }}
            >
              KO
            </button>
          </div>
          <div className="row">
            <label>Ability</label>
            <input
              value={state.left.ability || ""}
              onChange={(e) => handleChange("left.ability", e.target.value)}
            />
          </div>
          <div className="row">
            <label>Attack Name</label>
            <input
              value={state.left.attack?.name || ""}
              onChange={(e) => handleChange("left.attack.name", e.target.value)}
            />
          </div>
          <div className="row">
            <label>Attack Dmg</label>
            <input
              value={state.left.attack?.dmg ?? ""}
              onChange={(e) =>
                handleChange("left.attack.dmg", Number(e.target.value) || "")
              }
            />
          </div>
          {desiredBenchIndexesFor("left").map((i) => (
            <div key={i} className="row">
              <label>{`Bench #${i + 1}`}</label>
              <input
                value={
                  ((state.left.bench || [])[i] &&
                    (state.left.bench || [])[i]?.name) ||
                  ""
                }
                onChange={(e) => {
                  const next: any = structuredClone(state);
                  next.left.bench = next.left.bench || [];
                  next.left.bench[i] = next.left.bench[i] || {
                    name: "",
                    hp: 0,
                  };
                  next.left.bench[i].name = e.target.value;
                  setState(next);
                  sendFull(next);
                }}
              />
              <button
                className="btn"
                style={{ marginLeft: 8 }}
                onClick={() => swapActiveWithBench("left", i)}
              >
                Swap
              </button>
              <input
                type="number"
                id={`dec-left-bench-${i}`}
                placeholder="Dec"
                style={{ width: 80, marginLeft: 8 }}
              />
              <input
                type="number"
                id={`inc-left-bench-${i}`}
                placeholder="Inc"
                style={{ width: 80, marginLeft: 8 }}
              />
              <button
                className="btn"
                onClick={() => {
                  const decEl = document.getElementById(
                    `dec-left-bench-${i}`
                  ) as HTMLInputElement | null;
                  const incEl = document.getElementById(
                    `inc-left-bench-${i}`
                  ) as HTMLInputElement | null;
                  const dec = Number(decEl?.value) || 0;
                  const inc = Number(incEl?.value) || 0;
                  const delta = inc - dec;
                  if (!delta) return;
                  const next: any = structuredClone(state);
                  next.left.bench = next.left.bench || [];
                  next.left.bench[i] = next.left.bench[i] ?? {
                    name: "",
                    hp: 0,
                  };
                  next.left.bench[i].hp = Math.max(
                    0,
                    Number(next.left.bench[i].hp ?? 0) + delta
                  );
                  if ((next.left.bench[i].hp || 0) <= 0) {
                    // remove bench slot
                    next.left.bench[i] = null;
                    // compact bench array preserving indexes (keep nulls) - UI expects fixed 5 slots
                  }
                  setState(next);
                  sendFull(next);
                  if (decEl) decEl.value = "";
                  if (incEl) incEl.value = "";
                }}
                style={{ marginLeft: 8 }}
              >
                Confirm
              </button>
              <button
                className="btn"
                onClick={() => {
                  const next: any = structuredClone(state);
                  next.left.bench = next.left.bench || [];
                  next.left.bench[i] = null;
                  setState(next);
                  sendFull(next);
                }}
                style={{ marginLeft: 8 }}
              >
                KO
              </button>
              <input
                type="number"
                style={{ width: 80, marginLeft: 8 }}
                value={
                  ((state.left.bench || [])[i] &&
                    (state.left.bench || [])[i]?.hp) ??
                  0
                }
                onChange={(e) => {
                  const next: any = structuredClone(state);
                  next.left.bench = next.left.bench || [];
                  next.left.bench[i] = next.left.bench[i] || {
                    name: "",
                    hp: 0,
                  };
                  next.left.bench[i].hp = Number(e.target.value);
                  if ((next.left.bench[i].hp || 0) <= 0) {
                    next.left.bench[i] = null;
                  }
                  setState(next);
                  sendFull(next);
                }}
              />
            </div>
          ))}
          <div className="row">
            <label>Tool</label>
            <input
              value={state.left.tool || ""}
              onChange={(e) => handleChange("left.tool", e.target.value)}
            />
          </div>
          <div className="row">
            <label>Zones (top→bottom)</label>
            <input
              value={state.left.zones.join(" | ")}
              onChange={(e) =>
                handleChange(
                  "left.zones",
                  e.target.value.split("|").map((s) => s.trim())
                )
              }
            />
          </div>
        </div>

        <div
          className={
            "card" +
            ((state.turn as "left" | "right") === "right" ? " turn" : "")
          }
        >
          <h3>Right Player</h3>
          <div className="row">
            <label>Name</label>
            <input
              value={state.right.name}
              onChange={(e) => handleChange("right.name", e.target.value)}
            />
          </div>
          <div className="row">
            <label>Record</label>
            <input
              value={state.right.record}
              onChange={(e) => handleChange("right.record", e.target.value)}
            />
          </div>
          <div className="row">
            <label>Deck</label>
            <input
              value={state.right.deck}
              onChange={(e) => handleChange("right.deck", e.target.value)}
            />
          </div>
          <div className="row">
            <label>Active Name</label>
            <input
              value={state.right.active?.name || ""}
              onChange={(e) =>
                handleChange("right.active.name", e.target.value)
              }
            />
          </div>
          <div className="row">
            <label>Active HP</label>
            <input
              type="number"
              value={state.right.active?.hp ?? 0}
              onChange={(e) =>
                handleChange("right.active.hp", Number(e.target.value))
              }
            />
            <input
              type="number"
              id={`dec-right-active`}
              placeholder="Dec"
              style={{ width: 80, marginLeft: 8 }}
            />
            <input
              type="number"
              id={`inc-right-active`}
              placeholder="Inc"
              style={{ width: 80, marginLeft: 8 }}
            />
            <button
              className="btn"
              onClick={() => {
                const decEl = document.getElementById(
                  `dec-right-active`
                ) as HTMLInputElement | null;
                const incEl = document.getElementById(
                  `inc-right-active`
                ) as HTMLInputElement | null;
                const dec = Number(decEl?.value) || 0;
                const inc = Number(incEl?.value) || 0;
                const delta = inc - dec;
                if (!delta) return;
                const next: any = structuredClone(state);
                next.right.active = next.right.active ?? {
                  name: "",
                  hp: 0,
                  maxHp: 300,
                  image: "",
                };
                const curHp = Number(next.right.active.hp ?? 0) || 0;
                next.right.active.hp = Math.max(0, curHp + delta);
                if ((next.right.active.hp || 0) <= 0) {
                  // remove active on KO
                  next.right.active = null;
                  next.right.ability = "";
                  delete next.right.attack;
                  delete next.right.attack2;
                }
                setState(next);
                sendFull(next);
                if (decEl) decEl.value = "";
                if (incEl) incEl.value = "";
              }}
              style={{ marginLeft: 8 }}
            >
              Confirm
            </button>
          </div>
          <div className="row">
            <label>Ability</label>
            <input
              value={state.right.ability || ""}
              onChange={(e) => handleChange("right.ability", e.target.value)}
            />
          </div>
          <div className="row">
            <label>Attack Name</label>
            <input
              value={state.right.attack?.name || ""}
              onChange={(e) =>
                handleChange("right.attack.name", e.target.value)
              }
            />
          </div>
          <button
            className="btn"
            onClick={() => {
              const next: any = structuredClone(state);
              // remove active on KO
              next.right.active = null;
              next.right.ability = "";
              delete next.right.attack;
              delete next.right.attack2;
              setState(next);
              sendFull(next);
            }}
            style={{ marginLeft: 8 }}
          >
            KO
          </button>
          <div className="row">
            <label>Attack Dmg</label>
            <input
              value={state.right.attack?.dmg ?? ""}
              onChange={(e) =>
                handleChange("right.attack.dmg", Number(e.target.value) || "")
              }
            />
          </div>
          {desiredBenchIndexesFor("right").map((i) => (
            <div key={i} className="row">
              <label>{`Bench #${i + 1}`}</label>
              <input
                value={
                  ((state.right.bench || [])[i] &&
                    (state.right.bench || [])[i]?.name) ||
                  ""
                }
                onChange={(e) => {
                  const next: any = structuredClone(state);
                  next.right.bench = next.right.bench || [];
                  next.right.bench[i] = next.right.bench[i] || {
                    name: "",
                    hp: 0,
                  };
                  next.right.bench[i].name = e.target.value;
                  setState(next);
                  sendFull(next);
                }}
              />
              <button
                className="btn"
                style={{ marginLeft: 8 }}
                onClick={() => swapActiveWithBench("right", i)}
              >
                Swap
              </button>
              <input
                type="number"
                id={`dec-right-bench-${i}`}
                placeholder="Dec"
                style={{ width: 80, marginLeft: 8 }}
              />
              <input
                type="number"
                id={`inc-right-bench-${i}`}
                placeholder="Inc"
                style={{ width: 80, marginLeft: 8 }}
              />
              <button
                className="btn"
                onClick={() => {
                  const decEl = document.getElementById(
                    `dec-right-bench-${i}`
                  ) as HTMLInputElement | null;
                  const incEl = document.getElementById(
                    `inc-right-bench-${i}`
                  ) as HTMLInputElement | null;
                  const dec = Number(decEl?.value) || 0;
                  const inc = Number(incEl?.value) || 0;
                  const delta = inc - dec;
                  if (!delta) return;
                  const next: any = structuredClone(state);
                  next.right.bench = next.right.bench || [];
                  next.right.bench[i] = next.right.bench[i] ?? {
                    name: "",
                    hp: 0,
                  };
                  next.right.bench[i].hp = Math.max(
                    0,
                    Number(next.right.bench[i].hp ?? 0) + delta
                  );
                  if ((next.right.bench[i].hp || 0) <= 0) {
                    next.right.bench[i] = null;
                  }
                  setState(next);
                  sendFull(next);
                  if (decEl) decEl.value = "";
                  if (incEl) incEl.value = "";
                }}
                style={{ marginLeft: 8 }}
              >
                Confirm
              </button>
              <button
                className="btn"
                onClick={() => {
                  const next: any = structuredClone(state);
                  next.right.bench = next.right.bench || [];
                  next.right.bench[i] = null;
                  setState(next);
                  sendFull(next);
                }}
                style={{ marginLeft: 8 }}
              >
                KO
              </button>
              <input
                type="number"
                style={{ width: 80, marginLeft: 8 }}
                value={
                  ((state.right.bench || [])[i] &&
                    (state.right.bench || [])[i]?.hp) ??
                  0
                }
                onChange={(e) => {
                  const next: any = structuredClone(state);
                  next.right.bench = next.right.bench || [];
                  next.right.bench[i] = next.right.bench[i] || {
                    name: "",
                    hp: 0,
                  };
                  next.right.bench[i].hp = Number(e.target.value);
                  if ((next.right.bench[i].hp || 0) <= 0) {
                    next.right.bench[i] = null;
                  }
                  setState(next);
                  sendFull(next);
                }}
              />
            </div>
          ))}
          <div className="row">
            <label>Zones (top→bottom)</label>
            <input
              value={state.right.zones.join(" | ")}
              onChange={(e) =>
                handleChange(
                  "right.zones",
                  e.target.value.split("|").map((s) => s.trim())
                )
              }
            />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3>Card / Pokémon Search (local cards)</h3>
        <div className="row">
          <label>Search</label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Card or Pokémon"
          />
          <button
            className="btn"
            onClick={() => doSearch(query)}
            disabled={searching}
          >
            {searching ? "Searching..." : "Search"}
          </button>
        </div>
        <div className="row">
          {/* <label>Target</label>
          <select
            value={targetSide}
            onChange={(e) => setTargetSide(e.target.value as "left" | "right")}
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
          <select
            value={targetSlot as any}
            onChange={(e) => {
              const v = e.target.value;
              setTargetSlot(v === "active" ? "active" : Number(v));
            }}
          >
            <option value="active">Active</option>
            <option value={0}>Bench 1</option>
            <option value={1}>Bench 2</option>
            <option value={2}>Bench 3</option>
            <option value={3}>Bench 4</option>
            <option value={4}>Bench 5</option>
          </select> */}
        </div>

        {/* <div className="row">
          <label>Cache</label>
          <button className="btn" onClick={syncCache}>
            {caching ? "Syncing..." : "Sync Cache"}
          </button>
          <button
            className="btn"
            onClick={() => {
              localStorage.removeItem("tcg-cache");
              setLocalCache(null);
            }}
          >
            Clear Cache
          </button>
        </div> */}

        <div style={{ maxHeight: 320, overflow: "auto" }}>
          {results.length === 0 && <div className="tiny muted">No results</div>}
          {results.map((c, i) => {
            const eff = (state.turn as "left" | "right") || targetSide;
            const subs = (c.subtypes || []).map((s: any) =>
              String(s).toLowerCase()
            );
            const isUtility = subs.some((x: string) =>
              ["stadium", "item", "supporter", "tool"].includes(x)
            );
            return (
              <div
                key={c.id || i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 6,
                  borderBottom: "1px solid #eee",
                }}
              >
                <div style={{ width: 72, height: 72, flex: "0 0 72px" }}>
                  {c.images?.large || c.images?.small ? (
                    <img
                      src={c.images?.large || c.images?.small}
                      alt={c.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        background: "#f5f5f5",
                      }}
                    />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div className="tiny muted">
                    {c.set?.name || ""} {c.rarity ? `• ${c.rarity}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {!isUtility && (
                    <>
                      <button
                        className="btn"
                        onClick={() => {
                          const eff =
                            (state.turn as "left" | "right") || targetSide;
                          setActiveFromCard(eff, c);
                        }}
                      >
                        Active
                      </button>
                      {desiredBenchIndexesFor(eff).map((idx) => {
                        const slot = (state as any)[eff]?.bench?.[idx];
                        // consider a slot occupied only if it has a non-empty name
                        const occupied = !!(
                          slot && String(slot.name || "").trim() !== ""
                        );
                        return (
                          <button
                            key={idx}
                            className="btn"
                            disabled={occupied}
                            onClick={() => {
                              setBenchFromCard(eff, idx, c);
                            }}
                          >{`Bench ${idx + 1}`}</button>
                        );
                      })}

                      {/* Evolve buttons: if this card evolvesFrom something present on the side, show Evolve */}
                      {(c.evolvesFrom || c.evolveFrom) &&
                        (() => {
                          const fromNameRaw = String(
                            c.evolvesFrom || c.evolveFrom || ""
                          );
                          const fromNorm = normalizeName(fromNameRaw);
                          const eff =
                            (state.turn as "left" | "right") || targetSide;
                          const foundButtons: any[] = [];
                          // check active
                          const activeNameRaw = String(
                            state[eff].active?.name || ""
                          );
                          const activeNorm = normalizeName(activeNameRaw);
                          if (
                            activeNorm &&
                            (activeNorm === fromNorm ||
                              activeNorm.includes(fromNorm) ||
                              fromNorm.includes(activeNorm))
                          ) {
                            foundButtons.push(
                              <button
                                key="evolve-active"
                                className="btn"
                                onClick={() => {
                                  try {
                                    // Apply evolution but do NOT mark as a "used" card
                                    const newState =
                                      applyEvolution(eff, "active", c) || state;
                                    setState(newState);
                                    sendFull(newState);
                                  } catch {}
                                }}
                              >
                                Evolve Active
                              </button>
                            );
                          }
                          // check bench slots
                          for (const bi of desiredBenchIndexesFor(eff)) {
                            const bnameRaw = String(
                              (state as any)[eff]?.bench?.[bi]?.name || ""
                            );
                            const bnameNorm = normalizeName(bnameRaw);
                            if (
                              bnameNorm &&
                              (bnameNorm === fromNorm ||
                                bnameNorm.includes(fromNorm) ||
                                fromNorm.includes(bnameNorm))
                            ) {
                              foundButtons.push(
                                <button
                                  key={`evolve-bench-${bi}`}
                                  className="btn"
                                  onClick={() => {
                                    try {
                                      // Apply evolution to bench slot but do NOT mark as a used card
                                      const newState =
                                        applyEvolution(eff, bi, c) || state;
                                      setState(newState);
                                      sendFull(newState);
                                    } catch {}
                                  }}
                                >
                                  {`Evolve Bench ${bi + 1}`}
                                </button>
                              );
                            }
                          }
                          return foundButtons.length ? foundButtons : null;
                        })()}
                      {/* Rare Candy action on final evolution search results: if this card is a Stage 2 (or otherwise has 2-step ancestry), allow using Rare Candy to target a base Pokémon on the side */}
                      {(() => {
                        try {
                          const eff =
                            (state.turn as "left" | "right") || targetSide;
                          const slots: Array<{
                            slot: "active" | number;
                            label: string;
                            name: string;
                          }> = [];
                          const act = state[eff].active;
                          if (
                            act &&
                            act.name &&
                            evolutionDistanceToBase(c, act.name) === 2
                          ) {
                            slots.push({
                              slot: "active",
                              label: "Active",
                              name: act.name,
                            });
                          }
                          const bench = (state as any)[eff].bench || [];
                          for (const bi of desiredBenchIndexesFor(eff)) {
                            const b = bench[bi];
                            if (
                              b &&
                              b.name &&
                              evolutionDistanceToBase(c, b.name) === 2
                            ) {
                              slots.push({
                                slot: bi,
                                label: `Bench ${bi + 1}`,
                                name: b.name,
                              });
                            }
                          }
                          if (!slots.length) return null;
                          return (
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                              }}
                            >
                              {slots.map((slt, si) => (
                                <div
                                  key={si}
                                  style={{
                                    display: "flex",
                                    gap: 6,
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <div
                                    className="tiny muted"
                                    style={{ minWidth: 80 }}
                                  >
                                    {slt.label}
                                  </div>
                                  <button
                                    className="btn"
                                    onClick={() => {
                                      const eff =
                                        (state.turn as "left" | "right") ||
                                        targetSide;
                                      const newState =
                                        applyEvolution(
                                          eff,
                                          slt.slot as any,
                                          c
                                        ) || state;
                                      try {
                                        newState[eff] = newState[eff] || {};
                                        newState[eff].lastUsedAt = Date.now();
                                        newState[eff].lastUsedName =
                                          "Rare Candy";
                                        newState[eff].lastUsedType = "item";
                                        setState(newState);
                                        sendFull(newState);
                                      } catch {}
                                    }}
                                  >
                                    Use Rare Candy
                                  </button>
                                </div>
                              ))}
                            </div>
                          );
                        } catch {
                          return null;
                        }
                      })()}
                    </>
                  )}
                  {subs.includes("stadium") && (
                    <button
                      className="btn"
                      onClick={() => {
                        const next: any = structuredClone(state);
                        next.stadium = c.name || "";
                        setState(next);
                        sendFull(next);
                      }}
                    >
                      Set
                    </button>
                  )}
                  {subs.includes("item") &&
                    (() => {
                      const nameNorm = normalizeName(c.name || "");
                      if (
                        nameNorm === "rarecandy" ||
                        nameNorm === "rare-candy"
                      ) {
                        // Rare Candy inline buttons: show per eligible slot and per candidate evolution
                        const eff =
                          (state.turn as "left" | "right") || targetSide;
                        const slots = listEligibleSlotsForSide(eff);
                        if (!slots || slots.length === 0) {
                          return (
                            <button
                              className="btn"
                              onClick={() =>
                                window.alert(
                                  "No eligible Pokémon to Rare Candy on that side."
                                )
                              }
                            >
                              Use (Rare Candy)
                            </button>
                          );
                        }
                        return (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 6,
                            }}
                          >
                            {slots.map((s, si) => {
                              return (
                                <div
                                  key={si}
                                  style={{
                                    display: "flex",
                                    gap: 6,
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <div
                                    className="tiny muted"
                                    style={{ minWidth: 80 }}
                                  >
                                    {s.slot === "active"
                                      ? "Active"
                                      : `Bench ${s.slot + 1}`}
                                  </div>
                                  <button
                                    className="btn"
                                    onClick={() =>
                                      useRareCandyOnSlot(eff, s.slot, c)
                                    }
                                  >
                                    Use Rare Candy
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        );
                      }
                      return (
                        <button className="btn" onClick={() => applyUtility(c)}>
                          Use
                        </button>
                      );
                    })()}
                  {subs.includes("tool") && (
                    <button className="btn" onClick={() => applyUtility(c)}>
                      Attach
                    </button>
                  )}
                  {subs.includes("supporter") &&
                    (() => {
                      const eff =
                        (state.turn as "left" | "right") || targetSide;
                      const disabled = !!(state as any)[eff]?.supporterUsed;
                      return (
                        <button
                          className="btn"
                          onClick={() => applyUtility(c)}
                          disabled={disabled}
                        >
                          {disabled ? "Used" : "Use"}
                        </button>
                      );
                    })()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="btn-bar">
        <a
          className="btn primary"
          href="#/overlay"
          target="_blank"
          rel="noreferrer"
        >
          Open Overlay Window
        </a>
        <button className="btn" onClick={toggleFullscreen}>
          Toggle Fullscreen
        </button>
        <button className="btn" onClick={() => sendFull(state)}>
          Resend
        </button>
        <button
          className="btn"
          onClick={() => {
            localStorage.removeItem("tcg-overlay-state");
            location.reload();
          }}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}
