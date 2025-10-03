import { PlayerState } from "../state";
import { useEffect, useState, useRef } from "react";
import ALL_CARDS from "../cards/allCards";
import findCardByName from "../cards/findCardByName";
import AbilityBadge from "../components/AbilityBadge";
import AttackDisplay from "../components/AttackDisplay";

export default function PlayerPanel({
  side = "left",
  data,
  stadium,
  isTurn,
  showHp = true,
}: {
  side?: "left" | "right";
  data: PlayerState;
  stadium?: string;
  isTurn?: boolean;
  showHp?: boolean;
}) {
  const [croppedActive, setCroppedActive] = useState<string | null>(null);
  const prevActiveRef = useRef<any | null>(null);
  const [koActiveImage, setKoActiveImage] = useState<string | null>(null);
  const koTimerRef = useRef<number | null>(null);

  const prevActiveHpRef = useRef<number | null>(null);
  const [displayHp, setDisplayHp] = useState<number>(data?.active?.hp || 0);
  const [activeHpChange, setActiveHpChange] = useState<
    "increase" | "decrease" | null
  >(null);
  // when a swap occurs we briefly skip HP animations (both number and bar)
  const [skipHpAnim, setSkipHpAnim] = useState(false);
  const skipHpTimerRef = useRef<number | null>(null);
  const lastSwappedAtRef = useRef<number | null>(null);
  // helper: pick hi-res variant when available
  const pickHires = (raw: any) => {
    if (!raw) return null;
    let src = "";
    if (typeof raw === "string") src = raw;
    else {
      const obj = raw as any;
      if (obj?.large) src = obj.large;
      else if (obj?.small) src = obj.small;
      else src = String(raw);
    }
    try {
      const s = String(src);
      if (
        s.includes("images.pokemontcg.io") &&
        !s.includes("_hires") &&
        /\.(png|jpg|jpeg)$/i.test(s)
      ) {
        return s.replace(/\.(png|jpg|jpeg)$/i, "_hires.$1");
      }
    } catch {}
    return src || null;
  };

  const computeActiveScalePosFromSubtypes = (subtypes: string[] = []) => {
    const subs = (subtypes || []).map((s) => String(s).toLowerCase());
    let scale = 1.3;
    let pos = "0px -55px";
    if (subs.includes("tera")) {
      // Tera cards often need a larger scale and slightly different position
      scale = 1.2;
      pos = "0px -58px";
    } else if (subs.includes("stage 2") || subs.includes("stage2")) {
      scale = 1.3;
      pos = "0px -40px";
    } else if (subs.includes("ancient")) {
      scale = 1.3;
      pos = "0px -50px";
    } else if (subs.includes("stage 1") || subs.includes("stage1")) {
      scale = 1.3;
      pos = "0px -40px";
    } else if (subs.includes("basic")) {
      scale = 1.3;
      pos = "0px -40px";
    }
    return { scale, pos };
  };

  // bench thumbnails should use slightly different defaults
  const computeBenchThumbScalePosFromSubtypes = (subtypes: string[] = []) => {
    const subs = (subtypes || []).map((s) => String(s).toLowerCase());
    let scale = 1.1;
    let pos = "0px -20px";
    if (subs.includes("tera")) {
      scale = 1.2;
      pos = "0px -18px";
    } else if (subs.includes("ancient")) {
      scale = 1.2;
      pos = "0px -17px";
    } else if (subs.includes("stage 2") || subs.includes("stage2")) {
      scale = 1.2;
      pos = "0px -10px";
    } else if (subs.includes("stage 1") || subs.includes("stage1")) {
      scale = 1.25;
      pos = "0px -10px";
    } else if (subs.includes("basic")) {
      scale = 1.2;
      pos = "0px -10px";
    }
    return { scale, pos };
  };
  const isRight = side === "right";
  const maxHp = data?.active?.maxHp ?? 300;
  const hpPercent = Math.min(
    100,
    Math.round(((data?.active?.hp ?? 0) / (maxHp || 300)) * 100)
  );

  useEffect(() => {
    const raw = data?.active?.image;
    const picked = pickHires(raw);
    setCroppedActive(picked ? picked : null);
    // no animation: just update the image source and keep computed transform
  }, [data?.active?.image]);

  // detect KO: when active becomes null but previously there was an active, show KO animation
  useEffect(() => {
    try {
      const prev = prevActiveRef.current;
      const curr = data?.active || null;
      // if we had a previous active and now it's null, trigger KO animation
      if (prev && !curr) {
        const imgRaw = prev.image || prev.imageUrl || null;
        const img = pickHires(imgRaw) || imgRaw || null;
        if (img) {
          setKoActiveImage(img as string);
          if (koTimerRef.current) window.clearTimeout(koTimerRef.current);
          koTimerRef.current = window.setTimeout(() => {
            setKoActiveImage(null);
            koTimerRef.current = null;
          }, 900);
        }
      }
    } catch {}
    // update prevActiveRef for next render
    try {
      prevActiveRef.current = data?.active || null;
    } catch {}
    return () => {
      // cleanup timer
      if (koTimerRef.current) {
        window.clearTimeout(koTimerRef.current);
        koTimerRef.current = null;
      }
    };
  }, [data?.active]);

  // when a swap occurs, briefly apply a pulse transform to the image
  // When a swap occurs, reset HP animation state so the active image doesn't flash/shake
  useEffect(() => {
    if (!data?.swappedAt) return;
    const curr = data?.active?.hp ?? 0;
    // Immediately sync displayed HP and disable the HP animation for a short window
    prevActiveHpRef.current = curr;
    setDisplayHp(curr);
    setActiveHpChange(null);
    setSkipHpAnim(true);
    // remember this swappedAt so other effects can detect the exact swap event
    try {
      lastSwappedAtRef.current = (data as any).swappedAt || null;
    } catch {}
    if (skipHpTimerRef.current) window.clearTimeout(skipHpTimerRef.current);
    // keep skip enabled for a short duration to ensure no CSS/JS animation runs
    skipHpTimerRef.current = window.setTimeout(() => {
      setSkipHpAnim(false);
      // clear the remembered swappedAt after the skip window
      lastSwappedAtRef.current = null;
    }, 360);
    return () => {
      if (skipHpTimerRef.current) window.clearTimeout(skipHpTimerRef.current);
    };
  }, [data?.swappedAt]);
  // animate active HP number and flash color on change
  useEffect(() => {
    const prev = prevActiveHpRef.current;
    const curr = data?.active?.hp ?? 0;
    // If the state indicates a recent swap (exact swappedAt recorded by effect), skip HP animations
    try {
      const swappedAt = (data as any)?.swappedAt;
      if (
        swappedAt &&
        typeof swappedAt === "number" &&
        lastSwappedAtRef.current === swappedAt
      ) {
        prevActiveHpRef.current = curr;
        setDisplayHp(curr);
        setActiveHpChange(null);
        return;
      }
    } catch {}
    // If we're skipping via local flag, also skip
    if (skipHpAnim) {
      prevActiveHpRef.current = curr;
      setDisplayHp(curr);
      setActiveHpChange(null);
      return;
    }
    if (prev == null) {
      prevActiveHpRef.current = curr;
      setDisplayHp(curr);
      return;
    }
    if (prev === curr) return;
    const isDecrease = curr < prev;
    setActiveHpChange(isDecrease ? "decrease" : "increase");
    // animate number over 400ms
    const duration = 400;
    const start = performance.now();
    const from = prev;
    const to = curr;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const val = Math.round(from + (to - from) * t);
      setDisplayHp(val);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // clear color after animation
    const clearT = setTimeout(() => setActiveHpChange(null), duration + 80);
    prevActiveHpRef.current = curr;
    return () => clearTimeout(clearT);
  }, [data?.active?.hp]);

  // compute subtype-based transform for active card; prefer card data, fallback to ALL_CARDS lookup
  const activeSubtypeList = (() => {
    try {
      if (data?.active?.subtypes && (data.active.subtypes || []).length)
        return (data.active.subtypes || []).map((s: any) =>
          String(s).toLowerCase()
        );
      // fallback: try to find card by name in ALL_CARDS
      const name = data?.active?.name;
      if (name) {
        const found = findCardByName(name);
        if (found && found.subtypes)
          return (found.subtypes || []).map((s: any) =>
            String(s).toLowerCase()
          );
      }
    } catch {}
    return [] as string[];
  })();

  const { scale: computedImgScale, pos: computedImgObjectPosition } =
    computeActiveScalePosFromSubtypes(activeSubtypeList);
  // Force using computed transforms so left/right players render the same way.
  // Previously per-card overrides (imageScale/imagePos) could differ between sides and
  // cause inconsistent visuals; prefer consistent computed values here.
  const imgScale = computedImgScale;
  const imgObjectPosition = computedImgObjectPosition;

  // Prefer explicit use events recorded by Control: lastUsedAt / lastUsedName / lastUsedType
  const explicitUsedAt = (data as any)?.lastUsedAt || null;
  const explicitUsedName = (data as any)?.lastUsedName || null;
  const explicitUsedType = (data as any)?.lastUsedType || null;
  // fall back to tool/stadium if no explicit use recorded
  const fallbackUsedName =
    (data?.active?.tool as string) || (data?.tool as string) || stadium || null;
  const usedName = explicitUsedName || fallbackUsedName || null;
  const usedCard = usedName
    ? (() => {
        const target = String(usedName || "")
          .toLowerCase()
          .trim();
        // direct exact match first
        let found = findCardByName(target);
        if (found) return found;
        // normalized match: strip non-alphanum and compare
        const norm = (s: string) =>
          String(s || "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
        const targetNorm = norm(target);
        const exactNorm = findCardByName(target);
        if (exactNorm) return exactNorm;
        // substring fallback: find any card whose name contains the target (useful for short labels)
        const substr = findCardByName(target);
        return substr || null;
      })()
    : null;
  const usedImg = usedCard?.images?.large || usedCard?.images?.small || null;

  // stadium image fallback: try to find a card for the stadium prop and pick hires
  const stadiumImg = (() => {
    try {
      if (!stadium) return null;
      const key = String(stadium || "")
        .toLowerCase()
        .trim();
      let found = ALL_CARDS.find(
        (c: any) => String(c.name || "").toLowerCase() === key
      );
      if (!found) {
        found = ALL_CARDS.find((c: any) =>
          String(c.name || "")
            .toLowerCase()
            .includes(key)
        );
      }
      const raw = found?.images?.large || found?.images?.small || null;
      return pickHires(raw) || raw || null;
    } catch {
      return null;
    }
  })();

  // when a supporter/item/stadium is used, show the used card for a short duration
  const [showUsedTemporarily, setShowUsedTemporarily] = useState(false);
  const usedTimerRef = useRef<number | null>(null);
  // remember previous used name so we only show when a new card is used
  const prevUsedNameRef = useRef<string | null>(null);
  // previous explicit use timestamp to detect new Use clicks
  const prevExplicitUsedAtRef = useRef<number | null>(null);
  // track whether a Supporter has been shown this turn (supporter can be used once per turn)
  const seenSupporterThisTurnRef = useRef<boolean>(false);
  // UI state to render Supporter stat as disabled when used this turn
  const [supporterUsedThisTurn, setSupporterUsedThisTurn] = useState(false);
  const prevIsTurnRef = useRef<boolean | null>(null);
  // mounted state so we can play exit animation before unmounting
  const [showUsedMounted, setShowUsedMounted] = useState(false);
  const [usedAnimState, setUsedAnimState] = useState<"enter" | "exit" | "">("");
  // helper to show used image with consistent timing and cleanup
  const showUsed = () => {
    setShowUsedMounted(true);
    setUsedAnimState("enter");
    requestAnimationFrame(() => setShowUsedTemporarily(true));
    if (usedTimerRef.current) window.clearTimeout(usedTimerRef.current);
    usedTimerRef.current = window.setTimeout(() => {
      setUsedAnimState("exit");
      setShowUsedTemporarily(false);
      if (usedTimerRef.current) window.clearTimeout(usedTimerRef.current);
      usedTimerRef.current = window.setTimeout(() => {
        setShowUsedMounted(false);
        setUsedAnimState("");
        usedTimerRef.current = null;
        prevUsedNameRef.current = null;
      }, 260);
    }, 5000);
  };

  // Safety: if we are mounted to show a used card but the image disappears
  // (e.g., card lookup failed or state cleared), force the exit/unmount sequence
  useEffect(() => {
    if (!showUsedMounted) return;
    if (!usedImg) {
      // start exit immediately
      setUsedAnimState("exit");
      setShowUsedTemporarily(false);
      if (usedTimerRef.current) {
        window.clearTimeout(usedTimerRef.current);
        usedTimerRef.current = null;
      }
      const t = window.setTimeout(() => {
        setShowUsedMounted(false);
        setUsedAnimState("");
        clearTimeout(t);
      }, 260);
    }
  }, [showUsedMounted, usedImg]);
  useEffect(() => {
    // Only show the used image temporarily when it's this player's turn
    // and when an explicit use event occurred (Control clicked Use), or when
    // fallback tool/stadium is newly set while it's this player's turn.
    const prev = prevUsedNameRef.current;
    const prevExplicit = prevExplicitUsedAtRef.current;
    // detect turn start for this side: reset per-turn supporter tracking
    if (isTurn && prevIsTurnRef.current !== isTurn) {
      seenSupporterThisTurnRef.current = false;
    }
    // only react to explicit item uses (clicking Use in Control)
    const explicitIsNew = explicitUsedAt && prevExplicit !== explicitUsedAt;
    const explicitIsRecent =
      explicitUsedAt && Date.now() - (explicitUsedAt as number) < 10000;

    // if a new explicit use happened, mark it as seen so it won't re-fire on later turn flips
    if (explicitIsNew) {
      prevExplicitUsedAtRef.current = explicitUsedAt as number;
    }

    if (explicitIsNew && explicitIsRecent && isTurn) {
      // Only show when there's an explicit recent use recorded by Control
      // Enforce supporter per-turn rules via seenSupporterThisTurnRef
      const type = explicitUsedType || "";
      const isSupporter = type === "supporter";
      if (isSupporter) {
        if (!seenSupporterThisTurnRef.current) {
          showUsed();
          seenSupporterThisTurnRef.current = true;
          setSupporterUsedThisTurn(true);
          prevExplicitUsedAtRef.current = explicitUsedAt as number;
        }
      } else {
        // item/stadium/tool etc: always show when explicit use occurred
        showUsed();
        prevExplicitUsedAtRef.current = explicitUsedAt as number;
      }
    } else {
      // hide if there's no used image or it's not this player's turn
      setShowUsedTemporarily(false);
      setUsedAnimState("exit");
      if (usedTimerRef.current) {
        window.clearTimeout(usedTimerRef.current);
        usedTimerRef.current = null;
      }
      // unmount after exit animation
      const t = window.setTimeout(() => {
        setShowUsedMounted(false);
        setUsedAnimState("");
        clearTimeout(t);
      }, 260);
    }
    // Only update prevUsedNameRef when we actually show the used image.
    // If there's no usedImg, clear the ref so future uses will show.
    if (explicitUsedName && isTurn && prev !== explicitUsedName) {
      prevUsedNameRef.current = explicitUsedName;
    } else if (!explicitUsedName) {
      prevUsedNameRef.current = null;
    }

    // detect turn start for this side: reset per-turn supporter tracking
    if (isTurn && prevIsTurnRef.current !== isTurn) {
      seenSupporterThisTurnRef.current = false;
      setSupporterUsedThisTurn(false);
    }

    // if this player's turn ended (was true, now false), immediately clear any shown used card
    if (prevIsTurnRef.current === true && !isTurn) {
      // clear timers and hide used card immediately
      if (usedTimerRef.current) {
        window.clearTimeout(usedTimerRef.current);
        usedTimerRef.current = null;
      }
      setShowUsedTemporarily(false);
      setUsedAnimState("exit");
      // unmount after exit animation tick
      setTimeout(() => {
        setShowUsedMounted(false);
        setUsedAnimState("");
      }, 260);
    }
    // remember previous isTurn for next run
    prevIsTurnRef.current = isTurn ?? null;
    return () => {
      if (usedTimerRef.current) {
        window.clearTimeout(usedTimerRef.current);
        usedTimerRef.current = null;
      }
    };
  }, [usedImg, isTurn, usedName, explicitUsedAt, explicitUsedType]);

  const [randomCard, setRandomCard] = useState<any | null>(null);
  useEffect(() => {
    if (usedCard) {
      setRandomCard(null);
      return;
    }
    try {
      if (ALL_CARDS && ALL_CARDS.length) {
        const idx = Math.floor(Math.random() * ALL_CARDS.length);
        setRandomCard(ALL_CARDS[idx] || null);
      } else setRandomCard(null);
    } catch {
      setRandomCard(null);
    }
  }, [usedCard]);

  // bench add/change animation tracking
  const benchRef = useRef<any[] | null>(null);
  const [addedFlags, setAddedFlags] = useState<Record<number, boolean>>({});
  const [benchHpChange, setBenchHpChange] = useState<
    Record<number, "increase" | "decrease">
  >({});
  useEffect(() => {
    try {
      const prev = benchRef.current || [];
      const curr = (data?.bench || []) as any[];
      const newFlags: Record<number, boolean> = {};
      curr.forEach((slot: any, i: number) => {
        const prevSlot = prev[i];
        const currName = slot?.name || "";
        const prevName = prevSlot?.name || "";
        const currImg = slot?.image || "";
        const prevImg = prevSlot?.image || "";
        const prevHp = prevSlot?.hp ?? null;
        const currHp = slot?.hp ?? null;
        if (prevHp != null && currHp != null && prevHp !== currHp) {
          // If this bench HP change is the direct result of a recent swap, skip the bench HP
          // animation so it doesn't flash orange when active/bench are swapped.
          try {
            const swappedAt = (data as any)?.swappedAt;
            const skipBenchHp =
              lastSwappedAtRef.current &&
              swappedAt &&
              lastSwappedAtRef.current === swappedAt;
            if (!skipBenchHp) {
              setBenchHpChange((s) => ({
                ...s,
                [i]: currHp < prevHp ? "decrease" : "increase",
              }));
              setTimeout(() => {
                setBenchHpChange((s) => {
                  const copy = { ...s };
                  delete copy[i];
                  return copy;
                });
              }, 420);
            }
          } catch {
            // fallback: apply animation if any error
            setBenchHpChange((s) => ({
              ...s,
              [i]: currHp < prevHp ? "decrease" : "increase",
            }));
            setTimeout(() => {
              setBenchHpChange((s) => {
                const copy = { ...s };
                delete copy[i];
                return copy;
              });
            }, 420);
          }
        }
        // mark as added if there was no previous slot, or name/image changed
        if (
          (!prevSlot && slot) ||
          prevName !== currName ||
          prevImg !== currImg
        ) {
          newFlags[i] = true;
          // clear the flag after animation duration
          setTimeout(() => {
            setAddedFlags((s) => {
              const copy = { ...s };
              delete copy[i];
              return copy;
            });
          }, 360);
        }
      });
      if (Object.keys(newFlags).length)
        setAddedFlags((s) => ({ ...s, ...newFlags }));
      benchRef.current = curr.map((s) => (s ? { ...s } : null));
    } catch {
      // ignore
    }
  }, [data?.bench, side]);

  const activeAny = (data?.active || {}) as any;
  const activeAbility =
    activeAny?.ability ||
    activeAny?.abilities?.[0]?.name ||
    activeAny?.abilities?.[0]?.text ||
    activeAny?.abilities?.[0]?.ability ||
    (data as any)?.ability ||
    null;

  // dynamic bench sizing: compute desired slots and helpers (do not change DOM structure outside bench-list)
  const baseSlots = 5;
  const stadiumMap: Record<string, number> = {
    "area zero underdepths": 8,
  };
  const stadiumKey = (stadium || "").toLowerCase();
  // Only enable the stadium expansion if the player has a 'tera' subtype
  const hasTeraSubtype = (() => {
    try {
      // check active
      const active = data?.active;
      if (active) {
        const subs = (active.subtypes || []).map((s: any) =>
          String(s).toLowerCase()
        );
        if (subs.includes("tera")) return true;
        // fallback: try to resolve by name via ALL_CARDS
        const name = active.name;
        if (name) {
          const found = ALL_CARDS.find(
            (c: any) =>
              String(c.name || "").toLowerCase() === String(name).toLowerCase()
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
      }
      // check bench
      const bench = data?.bench || [];
      for (let i = 0; i < bench.length; i++) {
        const slot = bench[i];
        if (!slot) continue;
        const subs = (slot.subtypes || []).map((s: any) =>
          String(s).toLowerCase()
        );
        if (subs.includes("tera")) return true;
        const name = slot.name;
        if (name) {
          const found = ALL_CARDS.find(
            (c: any) =>
              String(c.name || "").toLowerCase() === String(name).toLowerCase()
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
      }
    } catch {
      // ignore lookup failures and treat as no tera
    }
    return false;
  })();
  const stadiumSlots = Object.keys(stadiumMap).find((k) =>
    stadiumKey.includes(k)
  )
    ? stadiumMap[
        Object.keys(stadiumMap).find((k) => stadiumKey.includes(k)) as string
      ]
    : 0;
  const stadiumSlotsEnabled = stadiumSlots && hasTeraSubtype ? stadiumSlots : 0;
  const benchLen = (data?.bench || []).length || 0;
  const desiredSlots =
    stadiumSlotsEnabled > 0
      ? Math.max(baseSlots, stadiumSlotsEnabled, benchLen)
      : baseSlots;
  const slotFlexPercent = 100 / desiredSlots;
  const compactBench = desiredSlots > 5;
  const desiredSlotIndexes = Array.from({ length: desiredSlots }, (_v, i) => i);

  return (
    <div
      className={[
        "side-outer",
        isRight ? "right" : "left",
        isTurn ? "turn" : "",
      ].join(" ")}
    >
      <div
        className={[
          "side",
          isRight ? "right" : "left",
          isTurn ? "turn" : "",
        ].join(" ")}
      >
        <div className="player-card">
          <div>
            <div
              className="player-name"
              style={{ display: "flex", gap: 10, alignItems: "center" }}
            >
              {data.name}
              <span className={"tiny muted"}> {data.record}</span>
            </div>

            <div className="player-prize-card">
              {/* Render six prize placeholders using the poke-life.svg in public.
                  Visual collected state is read from data.prizes (boolean[]). */}
              {Array.from({ length: 6 }).map((_, idx) => {
                const collected = Array.isArray(data?.prizes)
                  ? !!data?.prizes[idx]
                  : false;
                return (
                  <img
                    key={idx}
                    src="/poke-life.svg"
                    alt={`Prize ${idx + 1}`}
                    className={
                      "player-prize-img" + (collected ? " collected" : "")
                    }
                  />
                );
              })}
            </div>
          </div>
        </div>

        <div className={"active-panel"}>
          <div className="active-top">{data?.active?.name || ""}</div>
          <div className="active-mid">
            {data?.active?.image ? (
              <div
                style={{
                  width: "100%",
                  maxWidth: 624,
                  margin: "0 auto",
                  height: "100%",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <div
                  className={[
                    "active-image",
                    activeHpChange ? `hit-${activeHpChange}` : "",
                    koActiveImage ? "ko-anim" : "",
                  ].join(" ")}
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <img
                    src={
                      croppedActive ||
                      (data.active?.image as string) ||
                      (data?.active?.name ? "/pokeball.png" : undefined)
                    }
                    alt={data.active?.name || ""}
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "block",
                      objectFit: "cover",
                      transform: `scale(${imgScale})`,
                      objectPosition: imgObjectPosition,
                    }}
                  />
                  {/* small tool image badge in lower-right of active image */}
                  {(() => {
                    const toolName =
                      (data?.active as any)?.tool ||
                      (data as any)?.tool ||
                      null;
                    if (!toolName) return null;
                    try {
                      const found = ALL_CARDS.find(
                        (c: any) =>
                          String(c.name || "").toLowerCase() ===
                          String(toolName).toLowerCase()
                      );
                      const raw =
                        found?.images?.small || found?.images?.large || null;
                      const src = raw ? pickHires(raw) || raw : null;
                      if (!src) return null;
                      if (!found.subtypes.includes("Pokémon Tool")) return null;
                      return (
                        <div
                          style={{
                            position: "absolute",
                            left: isRight ? 255 : 25,
                            top: 260,
                            width: 60,
                            height: 35,
                            // borderRadius: 6,
                            pointerEvents: "none",
                            zIndex: 6,
                          }}
                        >
                          {true && (
                            <img
                              src={src as string}
                              alt={String(toolName)}
                              className="active-tool-badge"
                              style={{
                                width: "100%",
                                height: "100%",
                                display: "block",
                                objectFit: "cover",
                                transform: `scale(1.2)`,
                                transformOrigin: "center",
                                objectPosition: "center -10px",
                              }}
                            />
                          )}
                        </div>
                      );
                    } catch {
                      return null;
                    }
                  })()}
                  {/* show attached tool label on active if present */}

                  {koActiveImage ? (
                    <img
                      src={koActiveImage}
                      alt="KO"
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        pointerEvents: "none",
                      }}
                    />
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="active-empty-wait">
                <div className="waiting">
                  Waiting
                  <span className="dot dot1" />
                  <span className="dot dot2" />
                  <span className="dot dot3" />
                </div>
              </div>
            )}
          </div>

          <div
            className={["active-bottom", skipHpAnim ? "skip-hp-anim" : ""].join(
              " "
            )}
          >
            {showHp && data?.active?.name ? (
              <div className="active-hp-row">
                <div className="active-hp-text">
                  {displayHp != null ? `${displayHp}/${maxHp}` : ""}
                </div>
                <div className="active-hpbar">
                  <div
                    className={[
                      "active-hpbar-fill",
                      activeHpChange ? `hp-${activeHpChange}` : "",
                    ].join(" ")}
                    style={{ width: `${hpPercent}%` }}
                  />
                </div>
              </div>
            ) : null}
            {/* HP controls moved to Control UI; overlay displays animated changes only */}
            <div className="skills">
              {activeAbility && String(activeAbility).trim() !== "" && (
                <AbilityBadge
                  label="Ability"
                  used={Boolean(data?.active?.abilityUsed)}
                >
                  {activeAbility}
                </AbilityBadge>
              )}

              <div className="active-attack">
                {/* If explicit attack objects are not present on the state, try to
                    resolve the attack info from the bundled ALL_CARDS by matching
                    the active card name. This ensures AttackDisplay can find the
                    cost array and render energy icons even when only the name is set. */}
                <AttackDisplay
                  attack={
                    (data.attack as any) ||
                    ((): any => {
                      try {
                        const name = data?.active?.name;
                        if (!name) return null;
                        const found = ALL_CARDS.find(
                          (c: any) =>
                            String(c.name || "").toLowerCase() ===
                            String(name).toLowerCase()
                        );
                        if (!found || !Array.isArray(found.attacks))
                          return null;
                        return found.attacks[0] || null;
                      } catch {
                        return null;
                      }
                    })()
                  }
                  showEnergy={true}
                  cardName={data?.active?.name}
                />
              </div>

              {!activeAbility ? (
                <div className="active-attack">
                  <AttackDisplay
                    attack={
                      (data.attack2 as any) ||
                      ((): any => {
                        try {
                          const name = data?.active?.name;
                          if (!name) return null;
                          const found = ALL_CARDS.find(
                            (c: any) =>
                              String(c.name || "").toLowerCase() ===
                              String(name).toLowerCase()
                          );
                          if (!found || !Array.isArray(found.attacks))
                            return null;
                          return found.attacks[1] || null;
                        } catch {
                          return null;
                        }
                      })()
                    }
                    showEnergy={true}
                    cardName={data?.active?.name}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div
          className={
            "state-container " + (showUsedMounted ? "used-visible" : "")
          }
        >
          {showUsedMounted ? (
            <div
              className={
                "card-used " +
                (usedAnimState
                  ? usedAnimState + " " + (isRight ? "right" : "left")
                  : "")
              }
            >
              <img
                src={(usedImg || stadiumImg) as string | undefined}
                alt={usedName || stadium || "Used Card"}
              />
            </div>
          ) : (
            <div className="bench-list">
              <div className="bench-list-inner">
                {desiredSlotIndexes.map((i) => {
                  const slot = (data?.bench || [])[i] || null;
                  const name = slot?.name || "";
                  const hp = slot?.hp ?? null;
                  const img = slot?.image || null;
                  const slotAny = slot as any;
                  // normalize ability/attacks which may live under different keys
                  const slotAbility =
                    slotAny?.ability ||
                    slotAny?.abilities?.[0]?.name ||
                    slotAny?.abilities?.[0]?.text ||
                    slotAny?.abilities?.[0]?.ability ||
                    null;
                  const slotAttack =
                    slotAny?.attack ||
                    (slotAny?.attacks && slotAny.attacks[0]) ||
                    slotAny?.attack1 ||
                    slotAny?.attack_1 ||
                    null;
                  const slotAttack2 =
                    slotAny?.attack2 ||
                    (slotAny?.attacks && slotAny.attacks[1]) ||
                    slotAny?.attack_2 ||
                    slotAny?.attack1_2 ||
                    null;
                  const attackDmg = (a: any) =>
                    a?.dmg ?? a?.damage ?? a?.amount ?? null;

                  const addedClass = addedFlags[i]
                    ? `added-${isRight ? "right" : "left"}`
                    : "";
                  // when we have more than 5 slots, scale down visuals slightly
                  const compact = desiredSlots > 5;
                  return (
                    <div
                      key={i}
                      className={["bench-slot", addedClass].join(" ")}
                      style={{
                        // make each slot take an equal portion of the parent's height
                        flex: `0 0 ${slotFlexPercent}%`,
                        minHeight: 0,
                      }}
                    >
                      <div
                        className={[
                          "bench-thumb",
                          benchHpChange[i]
                            ? `bench-hit-${benchHpChange[i]}`
                            : "",
                        ].join(" ")}
                        style={{
                          width: compact ? 84 : 100,
                          height: compact ? 44 : 56,
                          borderRadius: 6,
                          background: "#4d5463ff",
                        }}
                      >
                        {(() => {
                          // compute subtype-based scale/position; fallback to defaults
                          let subs = [] as string[];
                          try {
                            if (slot?.subtypes)
                              subs = (slot.subtypes || []).map((s: any) =>
                                String(s).toLowerCase()
                              );
                            else if (name) {
                              const found = ALL_CARDS.find(
                                (c: any) =>
                                  String(c.name || "").toLowerCase() ===
                                  String(name).toLowerCase()
                              );
                              if (found && found.subtypes)
                                subs = (found.subtypes || []).map((s: any) =>
                                  String(s).toLowerCase()
                                );
                            }
                          } catch {}

                          const { scale: thumbScale, pos: thumbPos } =
                            computeBenchThumbScalePosFromSubtypes(subs);
                          const src = img || "/pokeball.png";
                          const objFit = img ? "cover" : "contain";
                          return (
                            <img
                              src={src}
                              alt={name || "Empty"}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: objFit,
                                transform: img
                                  ? `scale(${thumbScale})`
                                  : undefined,
                                objectPosition: img ? thumbPos : "50% 50%",
                                opacity: src === "/pokeball.png" ? 0.95 : 1,
                                display: "block",
                              }}
                            />
                          );
                        })()}
                      </div>

                      <div className="bench-meta">
                        <div className="bench-name">
                          {name || <span className="tiny muted">Empty</span>}
                        </div>
                        {slotAbility && String(slotAbility).trim() !== "" && (
                          <AbilityBadge
                            label="Ability"
                            size={15}
                            style={{ marginLeft: -13, marginBottom: -10 }}
                            used={Boolean(slot?.abilityUsed)}
                          >
                            {slotAbility}
                          </AbilityBadge>
                        )}
                        {(() => {
                          // Only show HP label/bar when the bench slot has a real Pokémon name.
                          const hasName =
                            slot && String(slot?.name || "").trim() !== "";
                          if (!hasName) return null;
                          if (!showHp) return null;
                          return (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                marginTop: 6,
                              }}
                            >
                              <div
                                className="tiny muted"
                                style={{ minWidth: 48, textAlign: "left" }}
                              >
                                {hp != null
                                  ? `${hp}/${slot?.maxHp ?? 100}`
                                  : ""}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div
                                  className="bench-hpbar"
                                  style={{
                                    width: "100%",
                                    height: 8,
                                    background: "rgba(255,255,255,0.05)",
                                    borderRadius: 6,
                                    overflow: "hidden",
                                  }}
                                >
                                  <div
                                    className={[
                                      "bench-hpbar-fill",
                                      benchHpChange[i]
                                        ? `hp-${benchHpChange[i]}`
                                        : "",
                                    ].join(" ")}
                                    style={{
                                      height: "100%",
                                      width: `${Math.max(
                                        0,
                                        Math.min(
                                          100,
                                          Math.round(
                                            ((hp ?? 0) / (slot?.maxHp ?? 100)) *
                                              100
                                          )
                                        )
                                      )}%`,
                                      background:
                                        "linear-gradient(90deg,#16a34a,#84cc16)",
                                    }}
                                  />
                                </div>
                                {/* HP controls moved to Control UI */}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="stat">
          <div className="stat-items">
            <div
              className={[
                "stat-item",
                supporterUsedThisTurn ? "disabled" : "",
              ].join(" ")}
            >
              Supporter
            </div>
            <div
              className={["stat-item", data?.energy ? "disabled" : ""].join(
                " "
              )}
            >
              Energy
            </div>

            <div
              className={[
                "stat-item",
                data?.retreatUsed ? "disabled" : "",
              ].join(" ")}
            >
              Retreat
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
