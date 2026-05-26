import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpTransport } from "../src/lsp/http-transport";

interface FetchCall {
  url: string;
  body: string;
}

function makeFetch(responder: (call: FetchCall) => unknown) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    const call: FetchCall = { url, body };
    calls.push(call);
    const payload = responder(call);
    return new Response(JSON.stringify(payload ?? []), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("HttpTransport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("POSTs each send as a single-element JSON array and dispatches the response", async () => {
    const { fn, calls } = makeFetch(({ body }) => {
      const arr = JSON.parse(body) as unknown[];
      if (arr.length === 0) return [];
      const req = arr[0] as { id: number };
      return [{ jsonrpc: "2.0", id: req.id, result: { ok: true } }];
    });
    const t = new HttpTransport({ url: "/lsp", fetch: fn, pollIntervalMs: 10_000 });

    const received: string[] = [];
    t.subscribe((msg) => received.push(msg));

    t.send(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }));
    await vi.waitFor(() => expect(received.length).toBe(1));

    expect(calls[0]?.url).toBe("/lsp");
    const sentArr = JSON.parse(calls[0]!.body);
    expect(Array.isArray(sentArr)).toBe(true);
    expect(sentArr).toHaveLength(1);
    expect(sentArr[0]).toMatchObject({ id: 7, method: "ping" });

    expect(JSON.parse(received[0]!)).toMatchObject({ id: 7, result: { ok: true } });

    t.dispose();
  });

  it("polls with an empty array on the configured interval while subscribers exist", async () => {
    const { fn, calls } = makeFetch(() => []);
    const t = new HttpTransport({ url: "/lsp", fetch: fn, pollIntervalMs: 100 });

    const handler = vi.fn();
    t.subscribe(handler);

    await vi.advanceTimersByTimeAsync(250);

    const polls = calls.filter((c) => c.body === "[]");
    expect(polls.length).toBeGreaterThanOrEqual(2);

    t.dispose();
  });

  it("stops polling once the last subscriber unsubscribes", async () => {
    const { fn, calls } = makeFetch(() => []);
    const t = new HttpTransport({ url: "/lsp", fetch: fn, pollIntervalMs: 50 });

    const handler = () => {};
    t.subscribe(handler);
    await vi.advanceTimersByTimeAsync(120);
    const before = calls.length;
    t.unsubscribe(handler);
    await vi.advanceTimersByTimeAsync(200);
    expect(calls.length).toBe(before);

    t.dispose();
  });

  it("dispatches multiple messages from one response in order", async () => {
    const { fn } = makeFetch(({ body }) => {
      const arr = JSON.parse(body) as unknown[];
      if (arr.length === 0) return [];
      return [
        { jsonrpc: "2.0", id: 1, result: 1 },
        { jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: "x" } },
      ];
    });
    const t = new HttpTransport({ url: "/lsp", fetch: fn, pollIntervalMs: 10_000 });

    const received: string[] = [];
    t.subscribe((m) => received.push(m));

    t.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }));
    await vi.waitFor(() => expect(received.length).toBe(2));

    expect(JSON.parse(received[0]!)).toMatchObject({ id: 1, result: 1 });
    expect(JSON.parse(received[1]!)).toMatchObject({ method: "textDocument/publishDiagnostics" });

    t.dispose();
  });

  it("throws on send after dispose", () => {
    const { fn } = makeFetch(() => []);
    const t = new HttpTransport({ url: "/lsp", fetch: fn });
    t.dispose();
    expect(() => t.send("{}")).toThrow(/disposed/i);
  });

  it("refuses to dispatch when the response is not a JSON array", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fn = vi.fn(async () => new Response("{\"oops\":true}", { status: 200 })) as unknown as typeof fetch;
    const t = new HttpTransport({ url: "/lsp", fetch: fn, pollIntervalMs: 10_000 });

    const handler = vi.fn();
    t.subscribe(handler);
    t.send(JSON.stringify({ id: 1 }));
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(handler).not.toHaveBeenCalled();

    t.dispose();
    consoleError.mockRestore();
  });
});
