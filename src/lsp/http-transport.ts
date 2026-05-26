import type { Transport } from "@codemirror/lsp-client";

/** Options accepted by {@link HttpTransport}. */
export interface HttpTransportOptions {
  /** Endpoint URL that accepts a JSON array of JSON-RPC messages and returns the same. */
  url: string;
  /** Optional `fetch` implementation, primarily for tests. */
  fetch?: typeof fetch;
}

/**
 * `Transport` implementation that tunnels JSON-RPC over HTTP/1.1.
 *
 * Each {@link send} POSTs a one-element JSON array. The endpoint returns a JSON
 * array of zero or more messages — the response, plus any queued server-pushed
 * notifications (e.g. `textDocument/publishDiagnostics`) — which are dispatched
 * to subscribers in order. The transport is purely request-driven: it never
 * polls. Diagnostics therefore piggy-back on the next outgoing message
 * (typically the user's next `didChange` or completion request), which is
 * fine while editing and avoids hammering the endpoint when idle.
 */
export class HttpTransport implements Transport {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private handlers: Array<(value: string) => void> = [];
  private inFlight = new Set<AbortController>();
  private disposed = false;

  constructor(opts: HttpTransportOptions) {
    this.url = opts.url;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  send(message: string): void {
    if (this.disposed) throw new Error("HttpTransport disposed");
    void this.post(`[${message}]`);
  }

  subscribe(handler: (value: string) => void): void {
    this.handlers.push(handler);
  }

  unsubscribe(handler: (value: string) => void): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  /** Abort in-flight requests and refuse further sends. */
  dispose(): void {
    this.disposed = true;
    for (const ctrl of this.inFlight) ctrl.abort();
    this.inFlight.clear();
    this.handlers = [];
  }

  private async post(body: string): Promise<void> {
    if (this.disposed) return;
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
      if (this.disposed) return;
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
