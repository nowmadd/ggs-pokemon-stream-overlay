// Auto-aggregated local card sets
import sv1 from "./sv1.json";
import sv2 from "./sv2.json";
import sv3 from "./sv3.json";
import sv3pt5 from "./sv3_5.json";
import sv4 from "./sv4.json";
import sv4pt5 from "./sv4_5.json";
import sv5 from "./sv5.json";
import sv6 from "./sv6.json";
import sv6pt5 from "./sv6_5.json";
import sv7 from "./sv7.json";
import sv8 from "./sv8.json";
import sv8pt5 from "./sv8_5.json";
import sv9 from "./sv9.json";
import sv10 from "./sv10.json";
import svp from "./svp.json";
import sve from "./sve.json";
import zsv10pt5 from "./sv10_5.json";

// flatten into one array
function withSet(arr: any[], id: string) {
  // Annotate cards with set metadata
  const annotated = (arr || []).map((c) => ({
    ...(c || {}),
    set: { id, name: id },
  }));
  // Deduplicate by name within this set, preferring cards that are not Promo/Special
  const byName: Record<string, any[]> = {};
  for (const c of annotated) {
    const name = c.name || "__unknown";
    byName[name] = byName[name] || [];
    byName[name].push(c);
  }
  const deduped: any[] = [];
  for (const name of Object.keys(byName)) {
    const group = byName[name];
    // prefer an entry whose rarity is not Promo or Special
    let chosen = group.find((g) => {
      const r = (g.rarity || "").toLowerCase();
      return r !== "promo" && r !== "special";
    });
    if (!chosen) chosen = group[0];
    deduped.push(chosen);
  }
  return deduped;
}

export const ALL_CARDS: any[] = [
  ...withSet(sv1, "sv1"),
  ...withSet(sv2, "sv2"),
  ...withSet(sv3, "sv3"),
  ...withSet(sv3pt5, "sv3pt5"),
  ...withSet(sv4, "sv4"),
  ...withSet(sv4pt5, "sv4pt5"),
  ...withSet(sv5, "sv5"),
  ...withSet(sv6, "sv6"),
  ...withSet(sv6pt5, "sv6pt5"),
  ...withSet(sv7, "sv7"),
  ...withSet(sv8, "sv8"),
  ...withSet(sv8pt5, "sv8pt5"),
  ...withSet(sv9, "sv9"),
  ...withSet(sv10, "sv10"),
  ...withSet(svp, "svp"),
  ...withSet(sve, "sve"),
  ...withSet(zsv10pt5, "zsv10pt5"),
];

export default ALL_CARDS;
