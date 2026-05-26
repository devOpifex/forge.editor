import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { rLanguage } from "./r-language";
import { rHoverTooltip } from "./hover";
import { defaultCatalog } from "./catalog";
import { lspExtensions } from "./lsp/extension";
import type { Catalog, EditorInstance, MountOptions } from "./types";

const forgeTheme = EditorView.baseTheme({
  ".cm-forge-info": { padding: "2px 0", maxWidth: "32rem" },
  ".cm-forge-sig": { fontFamily: "monospace", fontWeight: "bold", marginBottom: "2px" },
  ".cm-forge-doc": { fontSize: "90%", opacity: "0.85", whiteSpace: "normal" },
});

/** Construct a CodeMirror editor and return the host-facing handle. */
export function createEditor(parent: HTMLElement, opts: MountOptions = {}): EditorInstance {
  const catalog: Catalog = opts.catalog ?? defaultCatalog;
  const listeners = new Set<(code: string) => void>();
  if (opts.onChange) listeners.add(opts.onChange);

  const extensions = [
    basicSetup,
    rLanguage(catalog),
    rHoverTooltip(catalog),
    forgeTheme,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const code = update.state.doc.toString();
      for (const cb of listeners) cb(code);
    }),
  ];
  if (opts.readOnly) extensions.push(EditorState.readOnly.of(true));
  if (opts.theme === "dark") extensions.push(oneDark);

  let lspWiring: ReturnType<typeof lspExtensions> | null = null;
  if (opts.lsp) {
    const elementId = opts.lsp.elementId ?? parent.id;
    if (!elementId) {
      console.warn(
        "[forge.editor] LSP requested but the mount element has no id; " +
          "set `lsp.elementId` explicitly or give the element an id. Falling back to the static catalog."
      );
    } else {
      try {
        lspWiring = lspExtensions({ ...opts.lsp, elementId });
        extensions.push(lspWiring.extension);
      } catch (err) {
        console.warn("[forge.editor] LSP wiring failed:", err);
        lspWiring = null;
      }
    }
  }

  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: opts.value ?? "", extensions }),
  });

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (code: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: code },
      });
    },
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    focus: () => view.focus(),
    destroy: () => {
      view.destroy();
      if (lspWiring) lspWiring.dispose();
    },
  };
}
