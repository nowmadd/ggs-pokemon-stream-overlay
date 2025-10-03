import ALL_CARDS from "./allCards";

// Return the best card match for a given name.
// Preference order:
// 1) Exact name match with rarity not Promo/Special and image that looks like normal art
// 2) Exact name match preferring set-localization or non-promo
// 3) Substring matches
export default function findCardByName(name?: string) {
  if (!name) return null;
  const target = String(name || "")
    .toLowerCase()
    .trim();
  if (!target) return null;

  // exact match first
  const exact = ALL_CARDS.filter(
    (c: any) => String(c.name || "").toLowerCase() === target
  );
  if (exact.length) {
    // prefer entries whose rarity is not promo/special
    let candidates = exact.slice();
    const nonPromo = candidates.filter((c: any) => {
      const r = (c.rarity || "").toLowerCase();
      return r !== "promo" && r !== "special";
    });
    if (nonPromo.length) candidates = nonPromo;

    // prefer ones that have images (large or small)
    const withImg = candidates.filter(
      (c: any) => c.images && (c.images.large || c.images.small)
    );
    if (withImg.length) candidates = withImg;

    // If multiple candidates remain, pick the one from the newest set (best-effort):
    // extract numeric part from set id like 'sv8', 'sv8pt5', 'sv10_5', etc.
    const parseSetNum = (c: any) => {
      try {
        const sid = (c.set && c.set.id) || "";
        const m = String(sid).match(/(\d+(?:[._]\d+)?)/);
        if (m) return Number(String(m[1]).replace(/[_\.]/g, ""));
      } catch {}
      return 0;
    };
    candidates.sort((a: any, b: any) => parseSetNum(b) - parseSetNum(a));
    return candidates[0];
  }

  // normalized match: strip non-alphanum
  const norm = (s: string) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const targetNorm = norm(target);
  const exactNorm = ALL_CARDS.find(
    (c: any) => norm(c.name || "") === targetNorm
  );
  if (exactNorm) return exactNorm;

  // substring fallback: prefer non-promo
  const substr = ALL_CARDS.filter((c: any) =>
    String(c.name || "")
      .toLowerCase()
      .includes(target)
  );
  if (substr.length) {
    const normal = substr.find((c: any) => {
      const r = (c.rarity || "").toLowerCase();
      return r !== "promo" && r !== "special";
    });
    return normal || substr[0];
  }

  return null;
}
