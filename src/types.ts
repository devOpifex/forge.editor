/** A single autocomplete / hover entry exported by an R package. */
export interface CompletionItem {
  /** Symbol name, e.g. `filter`. */
  name: string;
  /** Kind of symbol; drives the completion icon. */
  type?: "function" | "object" | "dataset";
  /** Human-readable signature, e.g. `filter(.data, ..., .preserve = FALSE)`. */
  signature?: string;
  /** Short description shown in the completion popup and hover tooltip. */
  doc?: string;
}

/** Autocomplete metadata keyed by package name. */
export type Catalog = Record<string, CompletionItem[]>;

/** LSP-backed completion / hover / diagnostics options. */
export interface LSPOptions {
  /**
   * DOM id used to namespace the Shiny WebSocket channels
   * (`${elementId}_lsp_send` / `${elementId}_lsp_recv`). Must be unique
   * per editor on the page. Defaults to the mount element's `id` attribute.
   */
  elementId?: string;
  /** Workspace root URI advertised in the `initialize` request. */
  rootUri?: string;
  /** Per-document URI used for `textDocument/didOpen`. Defaults to `file:///__forge__.R`. */
  documentUri?: string;
  /** Language id used for `textDocument/didOpen`. Defaults to `"r"`. */
  languageId?: string;
}

/** Options accepted by {@link mount}. */
export interface MountOptions {
  /** Initial code to load into the editor. */
  value?: string;
  /** Completion metadata. Falls back to the bundled default catalog. */
  catalog?: Catalog;
  /** Render the editor read-only. */
  readOnly?: boolean;
  /** Colour theme. Defaults to `"light"`. */
  theme?: "light" | "dark";
  /** Convenience callback fired whenever the document changes. */
  onChange?: (code: string) => void;
  /** Wire the editor to a language server. When omitted, only the static catalog is used. */
  lsp?: LSPOptions;
}

/** Handle returned by {@link mount} for driving the editor from the host. */
export interface EditorInstance {
  /** Current editor contents. */
  getValue(): string;
  /** Replace the entire document. */
  setValue(code: string): void;
  /** Subscribe to document changes. Returns an unsubscribe function. */
  onChange(cb: (code: string) => void): () => void;
  /** Move keyboard focus into the editor. */
  focus(): void;
  /** Tear down the editor and free resources. */
  destroy(): void;
}
