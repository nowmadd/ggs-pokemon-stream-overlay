import React from "react";
import ALL_CARDS from "../cards/allCards";

type Attack = {
  name?: string;
  text?: string;
  dmg?: string | number;
  cost?: string[];
  costs?: string[];
  convertedEnergyCost?: number;
};

export default function AttackDisplay({
  attack,
  showEnergy = true,
  className = "",
  cardName,
}: {
  attack?: Attack | null;
  showEnergy?: boolean;
  className?: string;
  cardName?: string | null;
}) {
  if (!attack) return <span className={className}>&nbsp;</span>;

  let cost: string[] = (attack as any).cost || (attack as any).costs || [];

  // If no cost present on the attack object, try to resolve from bundled ALL_CARDS by card name + attack name
  if ((!cost || cost.length === 0) && cardName && attack.name) {
    try {
      const found = ALL_CARDS.find(
        (c: any) =>
          String(c.name || "").toLowerCase() === String(cardName).toLowerCase()
      );
      if (found && Array.isArray(found.attacks)) {
        const matched = found.attacks.find(
          (a: any) =>
            String(a.name || "").toLowerCase() ===
            String(attack.name || "").toLowerCase()
        );
        if (matched) cost = matched.cost || matched.costs || [];
      }
    } catch {}
  }

  const renderEnergy = (c: string, idx: number) => {
    const raw = String(c || "").trim();
    const lower = raw.toLowerCase();

    // normalize common variants to canonical filenames
    const synonyms: Record<string, string> = {
      electric: "electric",
      thunder: "electric",
      lightning: "electric",
      grass: "grass",
      plant: "grass",
      fire: "fire",
      water: "water",
      psychic: "psychic",
      fighting: "fighting",
      fight: "fighting",
      darkness: "darkness",
      dark: "darkness",
      metal: "steel",
      steel: "steel",
      fairy: "fairy",
      colorless: "colorless",
      colourless: "colorless",
      c: "colorless",
    };

    let key = lower.replace(/[^a-z0-9]+/g, "");
    if (!key) key = "colorless";
    if (synonyms[key]) key = synonyms[key];

    const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
    const src = `${base}/energies/${key}.png`;

    // Always render a reliable inline SVG for colorless energy to avoid broken/missing assets
    if (key === "colorless") {
      const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
      return (
        <img
          key={idx}
          src={`${base}/energies/colorless.png`}
          alt={raw}
          title={raw}
          className="attack-energy"
        />
      );
    }

    // fallback handler: if image not found, show colorless PNG (or ultimately inline SVG via onerror)
    const onErr = (ev: any) => {
      try {
        const img = ev?.target;
        if (img && img.dataset && img.dataset.fallback !== "1") {
          img.dataset.fallback = "1";
          img.src = `${base}/energies/colorless.png`;
        }
      } catch {}
    };

    return (
      <img
        key={idx}
        src={src}
        alt={raw}
        title={raw}
        data-energy={raw}
        className="attack-energy"
        onError={onErr}
      />
    );
  };

  return (
    <div
      className={`attack-display ${className}`}
      style={{
        flex: 1,
        display: "flex",
        justifyContent: "space-between",
        marginLeft: 20,
      }}
    >
      {showEnergy && (
        <span className="attack-energy-list" style={{ alignItems: "center" }}>
          {Array.isArray(cost) ? cost.map(renderEnergy) : null}
        </span>
      )}

      <span className="attack-label" style={{ textAlign: "center", width: 90 }}>
        {attack.name}
      </span>
      <span
        className="attack-label"
        style={{ textAlign: "center", marginRight: 20, width: 10 }}
      >
        {attack.dmg != null ? `${attack.dmg}` : ""}
      </span>
    </div>
  );
}
