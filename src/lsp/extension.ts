import type { Extension } from "@codemirror/state";
import { LSPClient, languageServerExtensions } from "@codemirror/lsp-client";
import { HttpTransport } from "./http-transport";
import type { LSPOptions } from "../types";

/** Result of {@link lspExtensions}: the CodeMirror extension plus a teardown hook. */
export interface LSPWiring {
  extension: Extension;
  dispose: () => void;
}

/**
 * Build the CodeMirror extension that wires the editor to a language server
 * over an {@link HttpTransport}. The returned object also exposes a `dispose`
 * function that should be called when the editor is destroyed.
 */
export function lspExtensions(opts: LSPOptions): LSPWiring {
  const transport = new HttpTransport({ url: opts.url });

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
