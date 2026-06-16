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

describe("mount() read-only + setReadOnly", () => {
  it("starts editable by default", () => {
    const inst = mountInto("x <- 1");
    expect(inst.isReadOnly()).toBe(false);
  });

  it("honours readOnly:true passed to mount()", () => {
    const inst = mountInto("x <- 1", { readOnly: true });
    expect(inst.isReadOnly()).toBe(true);
  });

  it("toggles read-only at runtime via setReadOnly", () => {
    const inst = mountInto("x <- 1");
    expect(inst.isReadOnly()).toBe(false);

    inst.setReadOnly(true);
    expect(inst.isReadOnly()).toBe(true);

    inst.setReadOnly(false);
    expect(inst.isReadOnly()).toBe(false);
  });
});
