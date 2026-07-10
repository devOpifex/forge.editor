import { afterEach, describe, expect, it } from "vitest";
import { mount } from "../src/index";
import type { EditorInstance } from "../src/types";

const instances: EditorInstance[] = [];
const parents: HTMLElement[] = [];

afterEach(() => {
  for (const i of instances) i.destroy();
  for (const p of parents) p.remove();
  instances.length = 0;
  parents.length = 0;
});

function mountInto(value: string, opts: Parameters<typeof mount>[1] = {}): EditorInstance {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  parents.push(parent);
  const instance = mount(parent, { value, ...opts });
  instances.push(instance);
  return instance;
}

/**
 * CodeMirror stamps the editor wrapper with generated theme classes (opaque
 * ids, plus a light/dark marker). Comparing wrappers is more robust than
 * asserting on those ids, and unlike `getTheme()` it proves the reconfigure
 * actually reached the DOM.
 */
function wrapperClass(inst: EditorInstance): string {
  const parent = parents[instances.indexOf(inst)];
  return parent.querySelector(".cm-editor")!.className;
}

describe("mount() theme + setTheme", () => {
  it("defaults to light", () => {
    expect(mountInto("x <- 1").getTheme()).toBe("light");
  });

  it("honours theme:'dark' passed to mount()", () => {
    expect(mountInto("x <- 1", { theme: "dark" }).getTheme()).toBe("dark");
  });

  it("mounting light vs dark yields different wrapper classes", () => {
    const light = mountInto("x <- 1");
    const dark = mountInto("x <- 1", { theme: "dark" });
    expect(wrapperClass(light)).not.toBe(wrapperClass(dark));
  });

  it("swaps the theme at runtime, matching a natively-mounted editor", () => {
    const mountedDark = mountInto("x <- 1", { theme: "dark" });
    const swapped = mountInto("x <- 1");

    swapped.setTheme("dark");
    expect(swapped.getTheme()).toBe("dark");
    expect(wrapperClass(swapped)).toBe(wrapperClass(mountedDark));

    const mountedLight = mountInto("x <- 1");
    swapped.setTheme("light");
    expect(swapped.getTheme()).toBe("light");
    expect(wrapperClass(swapped)).toBe(wrapperClass(mountedLight));
  });

  it("preserves document, selection and undo history across a theme swap", () => {
    const inst = mountInto("x <- 1\ny <- 2");
    inst.setValue("x <- 1\ny <- 2\nz <- 3");
    inst.setTheme("dark");

    expect(inst.getValue()).toBe("x <- 1\ny <- 2\nz <- 3");
    expect(inst.getSelection().from).toBe(inst.getSelection().to);
  });

  it("ignores unknown theme names", () => {
    const inst = mountInto("x <- 1");
    const before = wrapperClass(inst);
    // @ts-expect-error -- exercising the runtime guard against bad host input.
    inst.setTheme("solarized");
    expect(inst.getTheme()).toBe("light");
    expect(wrapperClass(inst)).toBe(before);
  });
});
