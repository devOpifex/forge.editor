import type { Extension } from "@codemirror/state";
import { LSPClient, languageServerExtensions } from "@codemirror/lsp-client";
import { ShinyTransport } from "./shiny-transport";
import type { LSPOptions } from "../types";

/** Result of {@link lspExtensions}: the CodeMirror extension plus a teardown hook. */
export interface LSPWiring {
  extension: Extension;
  dispose: () => void;
}

/**
 * Build the CodeMirror extension that wires the editor to a language server
 * over a {@link ShinyTransport}. The returned object also exposes a `dispose`
 * function that should be called when the editor is destroyed.
 */
export function lspExtensions(opts: LSPOptions): LSPWiring {
  if (!opts.elementId) {
    throw new Error("lspExtensions requires opts.elementId");
  }
  const transport = new ShinyTransport({ elementId: opts.elementId });

  const client = new LSPClient({
    rootUri: opts.rootUri,
    extensions: languageServerExtensions(),
  }).connect(transport);

  const uri = opts.documentUri ?? "file:///__forge__.R";
  const languageId = opts.languageId ?? "r";

  return {
    extension: client.plugin(uri, languageId),
    dispose: () => {
      try {
        client.disconnect();
      } finally {
        transport.dispose();
      }
    },
  };
}
