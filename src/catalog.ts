import type { Catalog, CompletionItem } from "./types";
import rawCatalog from "../data/catalog.json";

/** Catalog bundled with the package; used when the host supplies none. */
export const defaultCatalog: Catalog = rawCatalog as Catalog;

/** Merge several catalogs; later entries win on `package -> name` collisions. */
export function mergeCatalogs(...catalogs: Catalog[]): Catalog {
  const out: Catalog = {};
  for (const cat of catalogs) {
    for (const [pkg, items] of Object.entries(cat)) {
      const byName = new Map<string, CompletionItem>();
      for (const item of out[pkg] ?? []) byName.set(item.name, item);
      for (const item of items) byName.set(item.name, item);
      out[pkg] = [...byName.values()];
    }
  }
  return out;
}

/**
 * Look up a symbol in the catalog. When `pkg` is given the search is scoped to
 * that package (mirrors R's `pkg::name`); otherwise the first match across all
 * packages is returned.
 */
export function findItem(
  catalog: Catalog,
  name: string,
  pkg?: string,
): CompletionItem | undefined {
  if (pkg) return catalog[pkg]?.find((i) => i.name === name);
  for (const items of Object.values(catalog)) {
    const hit = items.find((i) => i.name === name);
    if (hit) return hit;
  }
  return undefined;
}
