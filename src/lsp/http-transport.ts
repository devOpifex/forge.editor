import type { Transport } from "@codemirror/lsp-client";

/** Options accepted by {@link HttpTransport}. */
export interface HttpTransportOptions {
  /** Endpoint URL that accepts a JSON array of JSON-RPC messages and returns the same. */
  url: string;
  /** Interval (ms) at which to poll for queued server notifications. Defaults to 1500. */
  pollIntervalMs?: number;
  /** Optional `fetch` implementation, primarily for tests. */
  fetch?: typeof fetch;
}

/**
 * `Transport` implementation that tunnels JSON-RPC over HTTP/1.1.
 *
 * Each {@link send} POSTs a one-element JSON array. The endpoint returns a JSON
 * array of zero or more messages (the response, plus any queued server-pushed
 * notifications such as diagnostics) which are dispatched to subscribers in
 * order. While at least one subscriber is registered the transport also drains
 * pending notifications on a fixed interval by POSTing an empty array.
 */
export class HttpTransport implements Transport {
  private readonly url: string;
  private readonly pollIntervalMs: number;
  private readonly fetchImpl: typeof fetch;
  private handlers: Array<(value: string) => void> = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight = new Set<AbortController>();
  private disposed = false;

  constructor(opts: HttpTransportOptions) {
    this.url = opts.url;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1500;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  send(message: string): void {
    if (this.disposed) throw new Error("HttpTransport disposed");
    void this.post(`[${message}]`);
  }

  subscribe(handler: (value: string) => void): void {
    this.handlers.push(handler);
    this.ensurePolling();
  }

  unsubscribe(handler: (value: string) => void): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
    if (this.handlers.length === 0) this.stopPolling();
  }

  /** Stop polling, abort in-flight requests, and refuse further sends. */
  dispose(): void {
    this.disposed = true;
    this.stopPolling();
    for (const ctrl of this.inFlight) ctrl.abort();
    this.inFlight.clear();
    this.handlers = [];
  }

  private ensurePolling(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      void this.post("[]");
    }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async post(body: string): Promise<void> {
    const ctrl = new AbortController();
    this.inFlight.add(ctrl);
    try {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`LSP HTTP ${res.status}: ${await safeText(res)}`);
      }
      const text = await res.text();
      if (!text) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(`LSP response is not JSON: ${(err as Error).message}`);
      }
      if (!Array.isArray(parsed)) {
        throw new Error("LSP response must be a JSON array of messages");
      }
      for (const msg of parsed) {
        if (msg === null || msg === undefined) continue;
        const serialized = typeof msg === "string" ? msg : JSON.stringify(msg);
        for (const h of this.handlers) h(serialized);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("[forge.editor] LSP transport error:", err);
    } finally {
      this.inFlight.delete(ctrl);
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
