import { useEffect, useState, useRef } from "react";
import PlayerPanel from "../components/PlayerPanel";
import ALL_CARDS from "../cards/allCards";
import { channel, loadState, saveState, OverlayState } from "../state";
// Optional WebSocket relay support (for cross-origin OBS setups)
let wsClientOverlay: WebSocket | null = null;
try {
  const hosts = [location.hostname, "localhost", "127.0.0.1"];
  for (const h of hosts) {
    try {
      // @ts-ignore
      const c = new WebSocket(`ws://${h}:8765`);
      c.addEventListener("open", () => {
        wsClientOverlay = c;
      });
      c.addEventListener("error", () => {
        if (c !== wsClientOverlay)
          try {
            c.close();
          } catch {}
      });
    } catch {}
    if (wsClientOverlay) break;
  }
} catch {
  wsClientOverlay = null;
}

export default function Overlay() {
  const [state, setState] = useState<OverlayState>(loadState);
  const params = new URLSearchParams(location.search);
  const debugEnabled = false;

  const [debug, setDebug] = useState<{ method: string; time: number } | null>(
    debugEnabled ? { method: "init", time: Date.now() } : null
  );
  const [showRaw, setShowRaw] = useState(false);

  // Track the last raw JSON saved to localStorage so we can ignore
  // redundant updates when syncing across channels.
  const lastRawRef = useRef<string | null>(null);

  useEffect(() => {
    saveState(state);
    try {
      lastRawRef.current = JSON.stringify(state);
    } catch {
      lastRawRef.current = null;
    }
  }, [state]);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const msg = ev.data as any;
      if (!msg) return;
      if (msg.type === "fullState") setState(msg.payload as OverlayState);
      if (msg.type === "patch") {
        const p = msg.payload as Partial<OverlayState>;
        setState((s) => {
          const next: any = structuredClone(s);
          for (const k of Object.keys(p)) {
            const val = (p as any)[k];
            if (k === "left" || k === "right") {
              // If the patch contains a player object, merge carefully:
              // - if it provides `active`, replace that active and clear ability/attacks if they're not present in the patch
              // - if it provides `bench`, merge bench entries by index
              // - otherwise shallow-merge player fields to avoid wiping unrelated data
              next[k] = next[k] || {};
              if (val && typeof val === "object" && "active" in val) {
                next[k].active = val.active;
                if (!("ability" in val)) delete next[k].ability;
                if (!("attack" in val)) delete next[k].attack;
                if (!("attack2" in val)) delete next[k].attack2;
              }
              if (val && typeof val === "object" && "bench" in val) {
                next[k].bench = next[k].bench || [];
                const b = val.bench;
                if (Array.isArray(b)) {
                  b.forEach((entry, idx) => {
                    if (entry == null) return;
                    next[k].bench[idx] = {
                      ...(next[k].bench[idx] || {}),
                      ...entry,
                    };
                  });
                } else if (b && typeof b === "object") {
                  for (const idxStr of Object.keys(b)) {
                    const idx = Number(idxStr);
                    if (Number.isNaN(idx)) continue;
                    next[k].bench[idx] = {
                      ...(next[k].bench[idx] || {}),
                      ...(b as any)[idxStr],
                    };
                  }
                }
              }
              // shallow-merge remaining top-level player fields
              for (const f of Object.keys(val || {})) {
                if (f === "active" || f === "bench") continue;
                (next[k] as any)[f] = (val as any)[f];
              }
            } else {
              next[k] = val;
            }
          }
          return next as OverlayState;
        });
      }
    };
    channel.addEventListener("message", onMsg as any);
    return () => channel.removeEventListener("message", onMsg as any);
  }, []);

  useEffect(() => {
    if (!wsClientOverlay) return () => {};
    const onWs = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (!msg) return;
        if (msg.type === "fullState") setState(msg.payload as OverlayState);
        if (msg.type === "patch") {
          const p = msg.payload as Partial<OverlayState>;
          setState((s) => {
            const next: any = structuredClone(s);
            for (const k of Object.keys(p)) {
              const val = (p as any)[k];
              if (k === "left" || k === "right") {
                next[k] = next[k] || {};
                if (val && typeof val === "object" && "active" in val) {
                  next[k].active = val.active;
                  if (!("ability" in val)) delete next[k].ability;
                  if (!("attack" in val)) delete next[k].attack;
                  if (!("attack2" in val)) delete next[k].attack2;
                }
                if (val && typeof val === "object" && "bench" in val) {
                  next[k].bench = next[k].bench || [];
                  const b = val.bench;
                  if (Array.isArray(b)) {
                    b.forEach((entry, idx) => {
                      if (entry == null) return;
                      next[k].bench[idx] = {
                        ...(next[k].bench[idx] || {}),
                        ...entry,
                      };
                    });
                  } else if (b && typeof b === "object") {
                    for (const idxStr of Object.keys(b)) {
                      const idx = Number(idxStr);
                      if (Number.isNaN(idx)) continue;
                      next[k].bench[idx] = {
                        ...(next[k].bench[idx] || {}),
                        ...(b as any)[idxStr],
                      };
                    }
                  }
                }
                for (const f of Object.keys(val || {})) {
                  if (f === "active" || f === "bench") continue;
                  (next[k] as any)[f] = (val as any)[f];
                }
              } else {
                next[k] = val;
              }
            }
            return next as OverlayState;
          });
        }
        // debug logging removed
      } catch {
        // ignore
      }
    };
    wsClientOverlay.addEventListener("message", onWs as any);
    return () => {
      if (wsClientOverlay)
        wsClientOverlay.removeEventListener("message", onWs as any);
    };
  }, [debugEnabled]);

  // Wrap BroadcastChannel handler to record update source when debug is enabled
  useEffect(() => {
    if (!debugEnabled) return;
    const onMsg = (ev: MessageEvent) => {
      const msg = ev.data as any;
      if (!msg) return;
      if (msg.type === "fullState") setState(msg.payload as OverlayState);
      if (msg.type === "patch")
        setState((s) => ({ ...s, ...(msg.payload as Partial<OverlayState>) }));
      setDebug({ method: "broadcast", time: Date.now() });
    };
    channel.addEventListener("message", onMsg as any);
    return () => channel.removeEventListener("message", onMsg as any);
  }, [debugEnabled]);

  // Storage event fallback: some embed contexts (OBS browser source or
  // cross-process frames) may not propagate BroadcastChannel messages.
  // Listen for `storage` changes and also poll localStorage periodically
  // as a final fallback.
  useEffect(() => {
    const key = "tcg-overlay-state";
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      const raw = e.newValue;
      if (!raw) return;
      if (raw === lastRawRef.current) return;
      try {
        const parsed = JSON.parse(raw) as OverlayState;
        setState(parsed);
        lastRawRef.current = raw;
        if (debugEnabled) {
          setDebug({ method: "storage", time: Date.now() });
          console.log("overlay debug: storage event", parsed);
        }
      } catch {
        // ignore parse errors
      }
    };

    window.addEventListener("storage", onStorage);

    // Polling fallback: some embed contexts don't fire `storage` events.
    const pollInterval = 800;
    const poll = setInterval(() => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return;
        if (raw === lastRawRef.current) return;
        const parsed = JSON.parse(raw) as OverlayState;
        setState(parsed);
        lastRawRef.current = raw;
        if (debugEnabled) {
          setDebug({ method: "poll", time: Date.now() });
          console.log("overlay debug: poll update", parsed);
        }
      } catch {
        // ignore parse errors and continue polling
      }
    }, pollInterval);

    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(poll);
    };
  }, []);

  // stadium flash visual state
  const [stadiumFlash, setStadiumFlash] = useState(false);

  // show a brief flash when the stadium value changes to a non-empty string
  const stadiumRef = useRef<string | null>(null);
  useEffect(() => {
    const curr = state.stadium || "";
    const prev = stadiumRef.current;
    stadiumRef.current = curr;
    if (!curr) return;
    // if stadium changed and is non-empty, trigger a flash
    if (prev !== null && prev !== curr) {
      setStadiumFlash(true);
      const t = window.setTimeout(() => setStadiumFlash(false), 1600);
      return () => clearTimeout(t);
    }
  }, [state.stadium]);

  // small helper to prefer hires images (same logic as PlayerPanel)
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

  // compute a stadium image URL (try exact name, then substring fallback)
  const stadiumImg = (() => {
    try {
      const s = state.stadium || "";
      if (!s) return null;
      const key = String(s).toLowerCase().trim();
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

  return (
    <div
      className="stage"
      style={{ width: state.canvas.width, height: state.canvas.height }}
    >
      {debug && (
        <div
          style={{
            position: "absolute",
            right: 8,
            top: 8,
            background: "rgba(0,0,0,0.6)",
            color: "#fff",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            zIndex: 9999,
            pointerEvents: "auto",
          }}
        >
          <div style={{ fontWeight: 600 }}>Overlay Debug</div>
          <div>method: {debug.method}</div>
          <div>time: {new Date(debug.time).toLocaleTimeString()}</div>
          <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
            <button
              onClick={() => setShowRaw((s) => !s)}
              style={{ fontSize: 11, padding: "4px 6px" }}
            >
              {showRaw ? "Hide JSON" : "Show JSON"}
            </button>
            <button
              onClick={() => {
                try {
                  const txt = JSON.stringify(state, null, 2);
                  navigator.clipboard?.writeText(txt);
                } catch {}
              }}
              style={{ fontSize: 11, padding: "4px 6px" }}
            >
              Copy
            </button>
          </div>
        </div>
      )}
      {debug && showRaw && (
        <div
          style={{
            position: "absolute",
            right: 8,
            top: 88,
            width: 520,
            maxHeight: "60vh",
            overflow: "auto",
            background: "rgba(0,0,0,0.85)",
            color: "#0ef",
            padding: 12,
            borderRadius: 8,
            zIndex: 9999,
            fontSize: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          <pre style={{ margin: 0, fontSize: 12 }}>
            {JSON.stringify(state, null, 2)}
          </pre>
        </div>
      )}
      <div
        className={"stadium " + (stadiumFlash ? "stadium-flash" : "")}
        style={
          stadiumImg
            ? {
                backgroundImage: `url(${stadiumImg})`,
                backgroundSize: "116%",
                backgroundPosition: "center -110px",
                backgroundRepeat: "no-repeat",
                backgroundColor: "rgba(2, 6, 23, 0.5)",
                backgroundBlendMode: "overlay",
              }
            : undefined
        }
      >
        <div className="stadium-inner">
          <div className="stadium-name">{state.stadium}</div>
        </div>
      </div>

      {/* countdown is intentionally not displayed centered in overlay */}

      <PlayerPanel
        side="left"
        data={state.left}
        stadium={state.stadium}
        isTurn={state.turn === "left"}
      />
      <PlayerPanel
        side="right"
        data={state.right}
        stadium={state.stadium}
        isTurn={state.turn === "right"}
      />

      <div className="center-strip">
        {/* camera feed sits behind overlay */}
      </div>

      <div className="footer">
        <div className="footer-pill">
          {state.roundLabel}{" "}
          <span className="timer">
            {
              // Prefer the match countdown (seconds) when present, otherwise show the small timer
              typeof state.countdown === "number"
                ? `${Math.floor((state.countdown || 0) / 60)}:${String(
                    (state.countdown || 0) % 60
                  ).padStart(2, "0")}`
                : state.timer
            }
          </span>
        </div>
      </div>
    </div>
  );
}
