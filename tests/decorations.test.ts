import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { deleteCharBackward } from "@codemirror/commands";
import { selectDecorations, type SelectDecorationSpec } from "../src/decorations";

let view: EditorView | null = null;
let parent: HTMLElement | null = null;

afterEach(() => {
  view?.destroy();
  parent?.remove();
  view = null;
  parent = null;
});

function setup(doc: string, specs: SelectDecorationSpec[]): EditorView {
  parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [selectDecorations(specs)] }),
  });
  return view;
}

const colorSpec: SelectDecorationSpec = {
  pattern: /"(red|green|blue)"/,
  options: () => [
    { value: '"red"', label: "red" },
    { value: '"green"', label: "green" },
    { value: '"blue"', label: "blue" },
  ],
};

describe("selectDecorations", () => {
  it("renders a <select> at a pattern match", () => {
    const v = setup('color <- "red"', [colorSpec]);
    const selects = v.dom.querySelectorAll("select.cm-forge-select");
    expect(selects).toHaveLength(1);
  });

  it("pre-selects the option matching the matched text", () => {
    const v = setup('color <- "green"', [colorSpec]);
    const select = v.dom.querySelector("select.cm-forge-select") as HTMLSelectElement;
    expect(select.value).toBe('"green"');
  });

  it("falls back to the first option when no option matches", () => {
    const spec: SelectDecorationSpec = {
      pattern: /__PICK__/,
      options: () => [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    };
    const v = setup("__PICK__", [spec]);
    const select = v.dom.querySelector("select.cm-forge-select") as HTMLSelectElement;
    expect(select.value).toBe("a");
  });

  it("commits the first option to the document when the match is a bare prefix", async () => {
    // The matched text is a prefix (`GET_CODELIST`) that is not itself one of the
    // options (`GET_CODELIST["…"]`). Selecting the first option visually isn't
    // enough — the document must be rewritten so the captured code is complete.
    const spec: SelectDecorationSpec = {
      pattern: /GET_CODELIST(?:\[[^\]\n]*\])?/,
      options: () => ['GET_CODELIST["first_id"]', 'GET_CODELIST["second_id"]'],
    };
    const v = setup("x <- GET_CODELIST", [spec]);
    const select = v.dom.querySelector("select.cm-forge-select") as HTMLSelectElement;
    expect(select.value).toBe('GET_CODELIST["first_id"]');
    // The write-back is deferred to a microtask.
    await Promise.resolve();
    expect(v.state.doc.toString()).toBe('x <- GET_CODELIST["first_id"]');
  });

  it("does not rewrite the document when the match is already a valid option", async () => {
    const v = setup('color <- "green"', [colorSpec]);
    await Promise.resolve();
    expect(v.state.doc.toString()).toBe('color <- "green"');
  });

  it("deletes the whole atomic token in one Backspace instead of re-expanding", async () => {
    // Regression: with an optional-group pattern, a partial delete leaves a bare
    // prefix the regex still matches, which the auto-commit would re-expand —
    // trapping the token. Atomic ranges make Backspace remove the whole token.
    const spec: SelectDecorationSpec = {
      pattern: /GET_CODELIST(?:\[[^\]\n]*\])?/,
      options: () => ['GET_CODELIST["first_id"]', 'GET_CODELIST["second_id"]'],
    };
    const v = setup('GET_CODELIST["first_id"]', [spec]);
    // Cursor at the very end, just after the (atomic) token.
    v.dispatch({ selection: { anchor: v.state.doc.length } });
    deleteCharBackward(v);
    await Promise.resolve();
    expect(v.state.doc.toString()).toBe("");
    expect(v.dom.querySelectorAll("select.cm-forge-select")).toHaveLength(0);
  });

  it("accepts plain-string options (value === label)", () => {
    const spec: SelectDecorationSpec = {
      pattern: /\bX\b/,
      options: () => ["X", "Y", "Z"],
    };
    const v = setup("X", [spec]);
    const select = v.dom.querySelector("select.cm-forge-select") as HTMLSelectElement;
    expect(select.value).toBe("X");
    expect(select.options).toHaveLength(3);
  });

  it("rewrites the matched range when an option is picked", () => {
    const v = setup('color <- "red"', [colorSpec]);
    const select = v.dom.querySelector("select.cm-forge-select") as HTMLSelectElement;
    select.value = '"blue"';
    select.dispatchEvent(new Event("change"));
    expect(v.state.doc.toString()).toBe('color <- "blue"');
  });

  it("keeps decorations live after the document is edited around them", () => {
    const v = setup('color <- "red"', [colorSpec]);
    v.dispatch({ changes: { from: 0, insert: "# comment\n" } });
    const selects = v.dom.querySelectorAll("select.cm-forge-select");
    expect(selects).toHaveLength(1);
    const select = selects[0] as HTMLSelectElement;
    select.value = '"green"';
    select.dispatchEvent(new Event("change"));
    expect(v.state.doc.toString()).toBe('# comment\ncolor <- "green"');
  });

  it("renders independent widgets for two disjoint specs", () => {
    const tagSpec: SelectDecorationSpec = {
      pattern: /@\w+@/,
      options: () => ["@x@", "@y@"],
    };
    const v = setup('color <- "red"; sym <- @x@', [colorSpec, tagSpec]);
    const selects = v.dom.querySelectorAll("select.cm-forge-select");
    expect(selects).toHaveLength(2);
  });

  it("first spec wins on overlapping ranges", () => {
    const outer: SelectDecorationSpec = {
      pattern: /AB/,
      options: () => ["AB", "CD"],
    };
    const inner: SelectDecorationSpec = {
      pattern: /B/,
      options: () => ["B", "X"],
    };
    const v = setup("AB", [outer, inner]);
    const selects = v.dom.querySelectorAll("select.cm-forge-select");
    expect(selects).toHaveLength(1);
    expect((selects[0] as HTMLSelectElement).value).toBe("AB");
  });

  it("shows the matched text disabled while async options load, then fills in", async () => {
    let resolve!: (opts: string[]) => void;
    const spec: SelectDecorationSpec = {
      pattern: /"(red|green|blue)"/,
      options: () => new Promise<string[]>((r) => (resolve = r)),
    };
    const v = setup('color <- "green"', [spec]);
    const select = v.dom.querySelector("select.cm-forge-select") as HTMLSelectElement;
    // Placeholder reflects the matched text and is locked until resolution.
    expect(select.disabled).toBe(true);
    expect(select.value).toBe('"green"');
    expect(select.options).toHaveLength(1);

    resolve(['"red"', '"green"', '"blue"']);
    await Promise.resolve();
    expect(select.disabled).toBe(false);
    expect(select.options).toHaveLength(3);
    expect(select.value).toBe('"green"');
  });

  it("re-enables the select if the async options reject", async () => {
    const spec: SelectDecorationSpec = {
      pattern: /\bX\b/,
      options: () => Promise.reject(new Error("nope")),
    };
    const v = setup("X", [spec]);
    const select = v.dom.querySelector("select.cm-forge-select") as HTMLSelectElement;
    await Promise.resolve();
    await Promise.resolve();
    expect(select.disabled).toBe(false);
  });

  it("renders a replace widget whose match spans a line break without throwing", () => {
    // A bracket class like [^\]]* matches newlines, so a match can cross a line
    // break. Replacing decorations that span a line break are illegal from a
    // ViewPlugin but legal from a StateField — this must not throw.
    const spec: SelectDecorationSpec = {
      pattern: /KW\[[^\]]*\]/,
      options: () => ["KW[a]", "KW[b]"],
    };
    const v = setup("KW[multi\nline]", [spec]);
    const selects = v.dom.querySelectorAll("select.cm-forge-select");
    expect(selects).toHaveLength(1);
  });

  it("survives deleting the closing bracket of a rendered token", () => {
    const spec: SelectDecorationSpec = {
      pattern: /KW\[[^\]]*\]/,
      options: () => ["KW[a]", "KW[b]"],
    };
    const v = setup("x <- KW[a]\nKW[b]", [spec]);
    expect(v.dom.querySelectorAll("select.cm-forge-select")).toHaveLength(2);
    // Delete the first token's closing "]" — the remaining open bracket now lets
    // the regex match across the newline to the next "]". Must not throw.
    expect(() => v.dispatch({ changes: { from: 9, to: 10 } })).not.toThrow();
    expect(v.state.doc.toString()).toBe("x <- KW[a\nKW[b]");
  });

  it("adds the global flag to non-global patterns so every match is decorated", () => {
    const spec: SelectDecorationSpec = {
      pattern: /\bX\b/,
      options: () => ["X", "Y"],
    };
    const v = setup("X X X", [spec]);
    const selects = v.dom.querySelectorAll("select.cm-forge-select");
    expect(selects).toHaveLength(3);
  });
});
