import type { MergeResolveEvent } from "./merge";
import type { SelectDecorationSpec } from "./decorations";

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

/** Colour themes shipped with the editor. */
export type Theme = "light" | "dark";

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

/** A snapshot of the editor's primary selection, returned by {@link EditorInstance.getSelection}. */
export interface SelectionInfo {
  /** Start offset of the selection in the document. */
  from: number;
  /** End offset of the selection in the document. */
  to: number;
  /** `true` when the selection is empty (a bare cursor, no highlighted text). */
  empty: boolean;
  /** The selected text (empty string when `empty`). */
  text: string;
  /** 1-based line number of the selection start. */
  fromLine: number;
  /** 1-based line number of the selection end. */
  toLine: number;
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
  theme?: Theme;
  /** Convenience callback fired whenever the document changes. */
  onChange?: (code: string) => void;
  /** Convenience callback fired once a merge (see {@link EditorInstance.setValue}) is fully resolved. */
  onMergeResolve?: (e: MergeResolveEvent) => void;
  /** Wire the editor to a language server. When omitted, only the static catalog is used. */
  lsp?: LSPOptions;
  /** Inline `<select>` widget decorations driven by regex patterns. */
  decorations?: SelectDecorationSpec[];
}

/** Handle returned by {@link mount} for driving the editor from the host. */
export interface EditorInstance {
  /** Current editor contents. */
  getValue(): string;
  /** Snapshot of the current primary selection (offsets, text and line range). */
  getSelection(): SelectionInfo;
  /**
   * Replace the entire document. With `{ merge: true }`, instead of replacing
   * outright, open a unified diff/merge view of `code` against the current
   * contents; the merge resolves (and {@link onMergeResolve} fires) once every
   * chunk is accepted or rejected.
   */
  setValue(code: string, opts?: { merge?: boolean }): void;
  /** Subscribe to document changes. Returns an unsubscribe function. */
  onChange(cb: (code: string) => void): () => void;
  /** Subscribe to merge resolution. Returns an unsubscribe function. */
  onMergeResolve(cb: (e: MergeResolveEvent) => void): () => void;
  /** True while a merge view is active. */
  isMerging(): boolean;
  /** Resolve a live merge by accepting all remaining chunks. */
  acceptAllChanges(): void;
  /** Resolve a live merge by rejecting all remaining chunks. */
  rejectAllChanges(): void;
  /** Replace the active inline `<select>` decoration specs. Pass `[]` to clear. */
  setDecorations(specs: ReadonlyArray<SelectDecorationSpec>): void;
  /** True while the editor is read-only. */
  isReadOnly(): boolean;
  /** Toggle read-only mode at runtime. */
  setReadOnly(readOnly: boolean): void;
  /** The active colour theme. */
  getTheme(): Theme;
  /** Swap the colour theme at runtime. Unknown values are ignored. */
  setTheme(theme: Theme): void;
  /** Move keyboard focus into the editor. */
  focus(): void;
  /** Tear down the editor and free resources. */
  destroy(): void;
}
