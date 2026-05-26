import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LSP_INIT_INPUT,
  ShinyTransport,
} from "../src/lsp/shiny-transport";

interface SetCall {
  name: string;
  value: unknown;
  opts?: { priority?: string };
}

function installShinyStub() {
  const setCalls: SetCall[] = [];
  const handlers = new Map<string, (msg: unknown) => void>();
  const setInputValue = vi.fn(
    (name: string, value: unknown, opts?: { priority?: string }) => {
      setCalls.push({ name, value, opts });
    }
  );
  const addCustomMessageHandler = vi.fn(
    (name: string, handler: (msg: unknown) => void) => {
      handlers.set(name, handler);
    }
  );
  (globalThis as unknown as { Shiny?: unknown }).Shiny = {
    setInputValue,
    addCustomMessageHandler,
  };
  return { setCalls, handlers, setInputValue, addCustomMessageHandler };
}

function clearShiny() {
  delete (globalThis as unknown as { Shiny?: unknown }).Shiny;
}

describe("ShinyTransport", () => {
  beforeEach(() => {
    clearShiny();
  });
  afterEach(() => {
    clearShiny();
  });

  it("fires a one-shot init message with the elementId on construction", () => {
    const { setCalls } = installShinyStub();
    new ShinyTransport({ elementId: "ed42" });
    const init = setCalls.find((c) => c.name === LSP_INIT_INPUT);
    expect(init).toBeDefined();
    expect(init!.value).toBe("ed42");
    expect(init!.opts?.priority).toBe("event");
  });

  it("namespaces send/recv channels by elementId", () => {
    const { setCalls, addCustomMessageHandler } = installShinyStub();
    const t = new ShinyTransport({ elementId: "ed42" });
    t.send(JSON.stringify({ id: 1, method: "ping" }));

    const sendCall = setCalls.find((c) => c.name === "ed42_lsp_send");
    expect(sendCall).toBeDefined();
    expect(sendCall!.opts?.priority).toBe("event");
    expect(typeof sendCall!.value).toBe("string");
    expect(JSON.parse(sendCall!.value as string)).toMatchObject({
      id: 1,
      method: "ping",
    });

    expect(addCustomMessageHandler).toHaveBeenCalledWith(
      "ed42_lsp_recv",
      expect.any(Function)
    );
  });

  it("dispatches inbound JSON strings verbatim to subscribers", () => {
    const { handlers } = installShinyStub();
    const t = new ShinyTransport({ elementId: "ed42" });
    const received: string[] = [];
    t.subscribe((m) => received.push(m));

    const recv = handlers.get("ed42_lsp_recv")!;
    const payload = JSON.stringify({ id: 1, result: { ok: true } });
    recv(payload);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(payload);
  });

  it("re-stringifies non-string inbound messages (defensive)", () => {
    const { handlers } = installShinyStub();
    const t = new ShinyTransport({ elementId: "ed42" });
    const received: string[] = [];
    t.subscribe((m) => received.push(m));

    const recv = handlers.get("ed42_lsp_recv")!;
    recv({ id: 2, result: 7 });

    expect(JSON.parse(received[0]!)).toMatchObject({ id: 2, result: 7 });
  });

  it("two transports with different elementIds use independent channels", () => {
    const { setCalls, handlers } = installShinyStub();
    const a = new ShinyTransport({ elementId: "a" });
    const b = new ShinyTransport({ elementId: "b" });

    a.send("{\"id\":1}");
    b.send("{\"id\":2}");

    expect(setCalls.some((c) => c.name === "a_lsp_send")).toBe(true);
    expect(setCalls.some((c) => c.name === "b_lsp_send")).toBe(true);

    const aReceived: string[] = [];
    const bReceived: string[] = [];
    a.subscribe((m) => aReceived.push(m));
    b.subscribe((m) => bReceived.push(m));
    handlers.get("a_lsp_recv")!("{\"forA\":true}");
    expect(aReceived).toEqual(["{\"forA\":true}"]);
    expect(bReceived).toEqual([]);
  });

  it("does not poll: no calls fire while idle", async () => {
    const { setCalls } = installShinyStub();
    new ShinyTransport({ elementId: "ed42" });
    const baseline = setCalls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(setCalls.length).toBe(baseline);
  });

  it("send becomes a no-op after dispose (no throw)", () => {
    const { setCalls } = installShinyStub();
    const t = new ShinyTransport({ elementId: "ed42" });
    t.dispose();
    const before = setCalls.length;
    expect(() => t.send("{}")).not.toThrow();
    expect(setCalls.length).toBe(before);
  });

  it("disposed transport ignores inbound messages", () => {
    const { handlers } = installShinyStub();
    const t = new ShinyTransport({ elementId: "ed42" });
    const received: string[] = [];
    t.subscribe((m) => received.push(m));
    t.dispose();
    handlers.get("ed42_lsp_recv")!("{\"late\":true}");
    expect(received).toEqual([]);
  });

  it("throws if Shiny is not loaded", () => {
    expect(() => new ShinyTransport({ elementId: "ed42" })).toThrow(/Shiny/);
  });

  it("throws on empty elementId", () => {
    installShinyStub();
    expect(() => new ShinyTransport({ elementId: "" })).toThrow(/elementId/);
  });
});
