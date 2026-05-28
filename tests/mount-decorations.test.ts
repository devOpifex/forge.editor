import { afterEach, describe, expect, it } from "vitest";
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

function mountInto(value: string, opts: Parameters<typeof mount>[1] = {}): EditorInstance {
  parent = document.createElement("div");
  document.body.appendChild(parent);
  instance = mount(parent, { value, ...opts });
  return instance;
}

describe("mount() decorations + setDecorations", () => {
  it("renders the initial decorations passed to mount()", () => {
    mountInto('color <- "red"', {
      decorations: [
        {
          pattern: /"(red|green|blue)"/,
          options: () => [
            { value: '"red"', label: "red" },
            { value: '"green"', label: "green" },
            { value: '"blue"', label: "blue" },
          ],
        },
      ],
    });
    expect(parent!.querySelectorAll("select.cm-forge-select")).toHaveLength(1);
  });

  it("swaps the active spec at runtime via setDecorations", () => {
    const inst = mountInto('color <- "red"; tag <- @x@');
    expect(parent!.querySelectorAll("select.cm-forge-select")).toHaveLength(0);

    inst.setDecorations([
      { pattern: /@\w+@/, options: () => ["@x@", "@y@"] },
    ]);
    expect(parent!.querySelectorAll("select.cm-forge-select")).toHaveLength(1);

    inst.setDecorations([
      {
        pattern: /"(red|green|blue)"/,
        options: () => [
          { value: '"red"', label: "red" },
          { value: '"green"', label: "green" },
          { value: '"blue"', label: "blue" },
        ],
      },
    ]);
    const selects = parent!.querySelectorAll("select.cm-forge-select");
    expect(selects).toHaveLength(1);
    expect((selects[0] as HTMLSelectElement).value).toBe('"red"');
  });

  it("clears decorations when setDecorations is called with an empty array", () => {
    const inst = mountInto('x <- "red"', {
      decorations: [
        { pattern: /"(red|green|blue)"/, options: () => ['"red"', '"green"', '"blue"'] },
      ],
    });
    expect(parent!.querySelectorAll("select.cm-forge-select")).toHaveLength(1);
    inst.setDecorations([]);
    expect(parent!.querySelectorAll("select.cm-forge-select")).toHaveLength(0);
  });
});
