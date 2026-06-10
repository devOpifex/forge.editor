import { afterEach, describe, expect, it } from "vitest";
import { acceptChunk, getChunks } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import { mount } from "../src/index";
import type { EditorInstance, MergeResolveEvent } from "../src/index";

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

// finishMerge() defers its reconfigure + listener fan-out to a microtask.
const flush = () => new Promise((r) => setTimeout(r, 0));

// The instance does not expose the underlying view; recover it from the DOM.
function viewOf(): EditorView {
  const view = EditorView.findFromDOM(parent!.querySelector(".cm-editor") as HTMLElement);
  if (!view) throw new Error("could not locate EditorView");
  return view;
}

describe("setValue({ merge: true })", () => {
  it("replaces the document outright without merge by default", () => {
    const inst = mountInto("x <- 1\n");
    inst.setValue("y <- 2\n");
    expect(inst.getValue()).toBe("y <- 2\n");
    expect(inst.isMerging()).toBe(false);
    expect(parent!.querySelectorAll(".cm-deletedChunk, .cm-changedLine")).toHaveLength(0);
  });

  it("opens a unified merge view diffing the new code against the current", () => {
    const inst = mountInto("x <- 1\n");
    inst.setValue("x <- 2\n", { merge: true });
    expect(inst.isMerging()).toBe(true);
    // The editor now holds the "new" side; original is the base for the diff.
    expect(inst.getValue()).toBe("x <- 2\n");
    expect(getChunks(viewOf().state)?.chunks.length ?? 0).toBeGreaterThan(0);
    expect(
      parent!.querySelector(".cm-changedLine, .cm-changedText, .cm-deletedChunk"),
    ).toBeTruthy();
  });

  it("no-ops the merge when the new code equals the current contents", () => {
    const inst = mountInto("x <- 1\n");
    inst.setValue("x <- 1\n", { merge: true });
    expect(inst.isMerging()).toBe(false);
  });

  it("resolves via acceptAllChanges, keeping the new content", async () => {
    const events: MergeResolveEvent[] = [];
    const inst = mountInto("x <- 1\n", { onMergeResolve: (e) => events.push(e) });
    inst.setValue("x <- 2\n", { merge: true });
    expect(inst.isMerging()).toBe(true);

    inst.acceptAllChanges();
    await flush();

    expect(inst.isMerging()).toBe(false);
    expect(inst.getValue()).toBe("x <- 2\n");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ code: "x <- 2\n", accepted: 1, rejected: 0 });
  });

  it("resolves via rejectAllChanges, restoring the original content", async () => {
    const events: MergeResolveEvent[] = [];
    const inst = mountInto("x <- 1\n", { onMergeResolve: (e) => events.push(e) });
    inst.setValue("x <- 2\n", { merge: true });

    inst.rejectAllChanges();
    await flush();

    expect(inst.isMerging()).toBe(false);
    expect(inst.getValue()).toBe("x <- 1\n");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ code: "x <- 1\n", accepted: 0, rejected: 1 });
  });

  it("counts a per-chunk accept and auto-resolves when no chunks remain", async () => {
    const events: MergeResolveEvent[] = [];
    const changes: string[] = [];
    const inst = mountInto("x <- 1\n", {
      onMergeResolve: (e) => events.push(e),
      onChange: (c) => changes.push(c),
    });
    inst.setValue("x <- 2\n", { merge: true });
    changes.length = 0; // ignore the doc change from entering merge

    // Drive the real accept path (dispatches userEvent "accept").
    const view = viewOf();
    const chunkPos = getChunks(view.state)!.chunks[0].fromB;
    acceptChunk(view, chunkPos);
    await flush();

    expect(inst.isMerging()).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ accepted: 1, rejected: 0 });
    // onChange is gated during the merge and re-emitted once on resolve.
    expect(changes).toEqual([events[0].code]);
  });
});
