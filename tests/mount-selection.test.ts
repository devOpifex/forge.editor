import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { mount } from "../src/index";
import type { EditorInstance } from "../src/types";

let instance: EditorInstance | null = null;
let parent: HTMLElement | null = null;

afterEach(() => {
  instance?.destroy();
  parent?.remove();
  instance = null;
  parent = null;
});

function mountInto(value: string): { inst: EditorInstance; parent: HTMLElement } {
  parent = document.createElement("div");
  document.body.appendChild(parent);
  instance = mount(parent, { value });
  return { inst: instance, parent };
}

function view(host: HTMLElement): EditorView {
  const dom = host.querySelector(".cm-editor") as HTMLElement;
  const v = EditorView.findFromDOM(dom);
  if (!v) throw new Error("EditorView not found in mount");
  return v;
}

describe("getSelection()", () => {
  it("reports an empty selection for a bare cursor at the start", () => {
    const { inst } = mountInto("x <- 1\ny <- 2");
    const sel = inst.getSelection();
    expect(sel.empty).toBe(true);
    expect(sel.from).toBe(0);
    expect(sel.to).toBe(0);
    expect(sel.text).toBe("");
    expect(sel.fromLine).toBe(1);
    expect(sel.toLine).toBe(1);
  });

  it("returns the highlighted text and 1-based line range", () => {
    const { inst, parent } = mountInto("x <- 1\ny <- 2\nz <- 3");
    const v = view(parent);
    // Select from the start of line 2 to the end of line 2 ("y <- 2").
    v.dispatch({ selection: EditorSelection.single(7, 13) });

    const sel = inst.getSelection();
    expect(sel.empty).toBe(false);
    expect(sel.text).toBe("y <- 2");
    expect(sel.from).toBe(7);
    expect(sel.to).toBe(13);
    expect(sel.fromLine).toBe(2);
    expect(sel.toLine).toBe(2);
  });

  it("spans multiple lines", () => {
    const { inst, parent } = mountInto("a\nb\nc");
    const v = view(parent);
    v.dispatch({ selection: EditorSelection.single(0, 3) }); // "a\nb"

    const sel = inst.getSelection();
    expect(sel.text).toBe("a\nb");
    expect(sel.fromLine).toBe(1);
    expect(sel.toLine).toBe(2);
  });
});
