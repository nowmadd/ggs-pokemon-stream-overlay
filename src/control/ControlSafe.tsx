import React from "react";
import { channel, loadState, saveState } from "../state";

export default function ControlSafe(): JSX.Element {
  const state = loadState();
  const resend = () => {
    try {
      channel.postMessage({ type: "fullState", payload: state });
      saveState(state);
    } catch {}
  };

  return (
    <div className="control-wrap">
      <h2>Control (Safe)</h2>
      <p className="muted">
        Using a temporary safe control UI — full features will be restored
        incrementally.
      </p>
      <div className="card">
        <div className="row">
          <label>Stadium</label>
          <input
            value={state.stadium || ""}
            onChange={(e) => {
              const next: any = structuredClone(state);
              next.stadium = e.target.value;
              saveState(next);
            }}
          />
        </div>
        <div className="btn-bar">
          <a
            className="btn primary"
            href="#/overlay"
            target="_blank"
            rel="noreferrer"
          >
            Open Overlay
          </a>
          <button className="btn" onClick={resend}>
            Resend
          </button>
        </div>
      </div>
    </div>
  );
}
