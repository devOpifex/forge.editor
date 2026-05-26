import type { Transport } from "@codemirror/lsp-client";

/**
 * Name of the Shiny input slot used to kick off the R-side bridge for a
 * newly mounted editor. The browser writes the editor's `elementId` here
 * once, and the R side spawns the per-editor `languageserver` subprocess
 * and registers the per-editor send/recv channels in response.
 */
export const LSP_INIT_INPUT = "forge_editor_lsp_init";

/** Options accepted by {@link ShinyTransport}. */
export interface ShinyTransportOptions {
  /**
   * Unique editor id; namespaces the Shiny input slot (`${elementId}_lsp_send`)
   * and the custom-message channel (`${elementId}_lsp_recv`) so multiple
   * editors in the same app never cross-talk.
   */
  elementId: string;
}

interface ShinyGlobal {
  setInputValue: (
    name: string,
    value: unknown,
    opts?: { priority?: "deferred" | "event" | "immediate" }
  ) => void;
  addCustomMessageHandler: (
    name: string,
    handler: (message: unknown) => void
  ) => void;
}

function getShiny(): ShinyGlobal {
  const Shiny = (globalThis as unknown as { Shiny?: ShinyGlobal }).Shiny;
  if (!Shiny || typeof Shiny.setInputValue !== "function") {
    throw new Error(
      "ShinyTransport requires Shiny.js to be loaded before the editor is mounted"
    );
  }
  return Shiny;
}

/**
 * `Transport` implementation that piggy-backs on the Shiny WebSocket.
 *
 * Outbound messages travel as `Shiny.setInputValue("${elementId}_lsp_send", ...)`
 * with `{ priority: "event" }`, so successive identical messages still fire the
 * server-side observer. Inbound messages arrive via a custom-message handler on
 * `${elementId}_lsp_recv`; the R side pushes pre-serialized JSON-RPC frames as
 * strings, which we forward verbatim to the LSP client to avoid a lossy
 * R-list round-trip (numeric scalars, explicit `null`s).
 */
export class ShinyTransport implements Transport {
  private readonly sendInput: string;
  private readonly recvChannel: string;
  private handlers: Array<(value: string) => void> = [];
  private disposed = false;

  constructor({ elementId }: ShinyTransportOptions) {
    if (!elementId) throw new Error("ShinyTransport requires elementId");
    const Shiny = getShiny();
    this.sendInput = `${elementId}_lsp_send`;
    this.recvChannel = `${elementId}_lsp_recv`;

    Shiny.addCustomMessageHandler(this.recvChannel, (msg) => {
      if (this.disposed) return;
      const text = typeof msg === "string" ? msg : JSON.stringify(msg);
      for (const h of this.handlers) h(text);
    });

    Shiny.setInputValue(LSP_INIT_INPUT, elementId, { priority: "event" });
  }

  send(message: string): void {
    if (this.disposed) return;
    getShiny().setInputValue(this.sendInput, message, { priority: "event" });
  }

  subscribe(handler: (value: string) => void): void {
    this.handlers.push(handler);
  }

  unsubscribe(handler: (value: string) => void): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  dispose(): void {
    this.disposed = true;
    this.handlers = [];
  }
}
