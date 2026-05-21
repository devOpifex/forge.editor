import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { rCompletionSource } from "../src/completion";
import { findItem } from "../src/catalog";
import type { Catalog } from "../src/types";

const catalog: Catalog = {
  dplyr: [
    { name: "filter", type: "function", signature: "filter(.data, ...)", doc: "Keep rows." },
    { name: "mutate", type: "function", signature: "mutate(.data, ...)" },
  ],
  forge: [
    { name: "forge_query", type: "function", signature: "forge_query(conn, sql)" },
  ],
};

function complete(doc: string, pos = doc.length, explicit = false) {
  const source = rCompletionSource(catalog);
  const state = EditorState.create({ doc });
  return source(new CompletionContext(state, pos, explicit));
}

describe("rCompletionSource", () => {
  it("offers the union of all packages on a bare identifier", () => {
    const res = complete("fil");
    expect(res).not.toBeNull();
    const labels = res!.options.map((o) => o.label);
    expect(labels).toContain("filter");
    expect(labels).toContain("forge_query");
    expect(res!.from).toBe(0);
  });

  it("scopes to the package after `pkg::`", () => {
    const res = complete("dplyr::");
    expect(res).not.toBeNull();
    expect(res!.options.map((o) => o.label).sort()).toEqual(["filter", "mutate"]);
    expect(res!.from).toBe("dplyr::".length);
  });

  it("keeps the partial after `pkg::` for filtering", () => {
    const res = complete("dplyr::fil");
    expect(res).not.toBeNull();
    expect(res!.from).toBe("dplyr::".length); // before the partial `fil`
    expect(res!.options.map((o) => o.label)).toContain("filter");
  });

  it("returns null for an unknown package qualifier", () => {
    expect(complete("nope::")).toBeNull();
  });

  it("attaches signature as completion detail", () => {
    const res = complete("dplyr::");
    const filter = res!.options.find((o) => o.label === "filter");
    expect(filter?.detail).toBe("filter(.data, ...)");
  });
});

describe("findItem", () => {
  it("finds across packages when no package given", () => {
    expect(findItem(catalog, "mutate")?.name).toBe("mutate");
  });

  it("scopes to a package when given", () => {
    expect(findItem(catalog, "filter", "dplyr")?.signature).toBe("filter(.data, ...)");
    expect(findItem(catalog, "filter", "forge")).toBeUndefined();
  });

  it("returns undefined for unknown symbols", () => {
    expect(findItem(catalog, "does_not_exist")).toBeUndefined();
  });
});
