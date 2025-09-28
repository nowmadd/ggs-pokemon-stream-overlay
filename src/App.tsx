import { useEffect, useState } from "react";
import Overlay from "./overlay/Overlay";
import Control from "./control/Control";

export default function App() {
  const pick = () =>
    location.hash.includes("control") ? "control" : "overlay";
  const [mode, setMode] = useState<"overlay" | "control">(pick);

  useEffect(() => {
    const onHash = () => setMode(pick());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return mode === "control" ? <Control /> : <Overlay />;
}
