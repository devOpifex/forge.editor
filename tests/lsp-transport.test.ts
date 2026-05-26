import { describe, expect, it, vi } from "vitest";
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
  it("POSTs each send as a single-element JSON array and dispatches the response", async () => {
    const { fn, calls } = makeFetch(({ body }) => {
      const arr = JSON.parse(body) as unknown[];
      if (arr.length === 0) return [];
      const req = arr[0] as { id: number };
      return [{ jsonrpc: "2.0", id: req.id, result: { ok: true } }];
    });
    const t = new HttpTransport({ url: "/lsp", fetch: fn });

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

  it("does not poll the endpoint when idle", async () => {
    vi.useFakeTimers();
    try {
      const { fn, calls } = makeFetch(() => []);
      const t = new HttpTransport({ url: "/lsp", fetch: fn });

      t.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls.length).toBe(0);

      t.dispose();
    } finally {
      vi.useRealTimers();
    }
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
    const t = new HttpTransport({ url: "/lsp", fetch: fn });

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

  it("swallows errors silently once disposed (no console noise after teardown)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const slow = vi.fn(
      () =>
        new Promise<Response>((_resolve, reject) => {
          setTimeout(() => reject(new TypeError("NetworkError")), 5);
        })
    ) as unknown as typeof fetch;
    const t = new HttpTransport({ url: "/lsp", fetch: slow });
    t.subscribe(() => {});
    t.send("{}");
    t.dispose();
    await new Promise((r) => setTimeout(r, 20));
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("refuses to dispatch when the response is not a JSON array", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fn = vi.fn(async () => new Response("{\"oops\":true}", { status: 200 })) as unknown as typeof fetch;
    const t = new HttpTransport({ url: "/lsp", fetch: fn });

    const handler = vi.fn();
    t.subscribe(handler);
    t.send(JSON.stringify({ id: 1 }));
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(handler).not.toHaveBeenCalled();

    t.dispose();
    consoleError.mockRestore();
  });
});
