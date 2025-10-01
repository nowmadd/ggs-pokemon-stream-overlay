import React, { useState } from "react";

export default function AbilityBadge({
  label,
  children,
  className,
  style,
  labelImgSrc,
  size,
  used,
}: {
  label?: string | null;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  // optional path to an image used for the label (e.g. '/ability-badge.png')
  labelImgSrc?: string;
  // size in px for the label image and related spacing
  size?: number;
  // whether the ability has been used (grayscale label)
  used?: boolean;
}) {
  const defaultSrc = labelImgSrc || "/ability-badge.png";
  const altSrc = "/ability.png";
  const [currentSrc, setCurrentSrc] = useState(defaultSrc);
  const [imgLoaded, setImgLoaded] = useState(false);
  const resolvedSize = (size ||
    (style && (style as any).height) ||
    22) as number;

  const mergedStyle: React.CSSProperties = {
    ...(style || {}),
    // expose CSS variable for stylesheet
    ["--ability-badge-size" as any]: `${resolvedSize}px`,
    display: "flex",
    alignItems: "center",
    gap: 1,
    flex: 1,
    justifyContent: "space-between",
  };

  return (
    <div
      className={[
        "ability-badge",
        className || "",
        used ? "ability-used" : "",
      ].join(" ")}
      style={mergedStyle}
    >
      {label ? (
        // prefer an image if available; show fallback text only until image loads
        <>
          <div
            className="ability-label-wrap"
            style={{ alignContent: "center" }}
          >
            <img
              className="ability-label-img"
              src={currentSrc}
              alt={String(label)}
              onError={(e) => {
                if (currentSrc !== altSrc) {
                  setCurrentSrc(altSrc);
                } else {
                  (e.target as HTMLImageElement).style.display = "none";
                  setImgLoaded(false);
                }
              }}
              onLoad={() => setImgLoaded(true)}
              style={{
                display: imgLoaded ? "inline-block" : "none",
                height: `var(--ability-badge-size, ${resolvedSize}px)`,
              }}
            />
            {!imgLoaded ? (
              <div className="ability-label-fallback">{label}</div>
            ) : null}
          </div>
        </>
      ) : null}
      <div
        className="ability-title"
        style={{ fontSize: Math.max(10, Math.round(resolvedSize * 0.6)) }}
      >
        {children}
      </div>
      <div style={{ width: 30 }}></div>
    </div>
  );
}
