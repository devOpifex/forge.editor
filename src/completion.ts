import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { Catalog, CompletionItem } from "./types";
import { renderInfo } from "./info";

const ICON: Record<NonNullable<CompletionItem["type"]>, string> = {
  function: "function",
  object: "variable",
  dataset: "constant",
};

function toCompletion(item: CompletionItem): Completion {
  return {
    label: item.name,
    type: ICON[item.type ?? "function"],
    detail: item.signature,
    info: item.signature || item.doc ? () => renderInfo(item) : undefined,
  };
}

// `pkg::name` or `pkg:::name` access, anchored to the cursor.
const QUALIFIED = /^([A-Za-z.][\w.]*):{2,3}([\w.]*)$/;
// A bare R identifier (allows dots, e.g. `read.csv`).
const IDENT = /[\w.]*$/;

/**
 * Build a CodeMirror completion source backed by a static {@link Catalog}.
 *
 * - After `pkg::`, only that package's exports are offered.
 * - Otherwise the union of all packages' symbols is offered and CodeMirror's
 *   built-in fuzzy matcher filters them as the user types.
 */
export function rCompletionSource(
  catalog: Catalog,
): (ctx: CompletionContext) => CompletionResult | null {
  const byPackage: Record<string, Completion[]> = {};
  const all: Completion[] = [];
  const seen = new Set<string>();
  for (const [pkg, items] of Object.entries(catalog)) {
    byPackage[pkg] = items.map(toCompletion);
    for (const item of items) {
      if (seen.has(item.name)) continue;
      seen.add(item.name);
      all.push(toCompletion(item));
    }
  }

  return (ctx: CompletionContext): CompletionResult | null => {
    const qualified = ctx.matchBefore(/[A-Za-z.][\w.]*:{2,3}[\w.]*/);
    if (qualified) {
      const m = QUALIFIED.exec(qualified.text);
      if (m) {
        const options = byPackage[m[1]];
        if (!options) return null;
        return {
          from: qualified.to - m[2].length,
          options,
          validFor: /^[\w.]*$/,
        };
      }
    }

    const word = ctx.matchBefore(IDENT);
    if ((!word || word.from === word.to) && !ctx.explicit) return null;
    return {
      from: word ? word.from : ctx.pos,
      options: all,
      validFor: /^[\w.]*$/,
    };
  };
}
