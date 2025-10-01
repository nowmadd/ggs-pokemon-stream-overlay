import ALL_CARDS from "../cards/allCards";

export function canPlaceOnBench(card: any): boolean {
  if (!card) return false;
  try {
    // Prefer explicit subtype information
    const subs = (card.subtypes || []).map((s: any) => String(s).toLowerCase());
    if (subs.includes("basic")) return true;
    if (
      subs.includes("stage 1") ||
      subs.includes("stage1") ||
      subs.includes("stage 2") ||
      subs.includes("stage2")
    )
      return false;

    // If explicit evolvesFrom present, treat as a Stage (deny)
    if (card.evolvesFrom || card.evolveFrom) return false;

    // Fallback: try to find the card by name in bundled ALL_CARDS
    if (card.name) {
      const name = String(card.name || "")
        .toLowerCase()
        .trim();
      const found = ALL_CARDS.find(
        (c: any) =>
          String(c.name || "")
            .toLowerCase()
            .trim() === name
      );
      if (found && Array.isArray(found.subtypes)) {
        const fsubs = (found.subtypes || []).map((s: any) =>
          String(s).toLowerCase()
        );
        if (fsubs.includes("basic")) return true;
        if (
          fsubs.includes("stage 1") ||
          fsubs.includes("stage1") ||
          fsubs.includes("stage 2") ||
          fsubs.includes("stage2")
        )
          return false;
      }
    }
  } catch (e) {
    // fallthrough
  }
  // Deny by default when uncertain to avoid invalid placements
  // Developers can inspect the console for the warning
  console.warn("canPlaceOnBench: denying placement by default for card:", card);
  return false;
}
