import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getChunks } from "@codemirror/merge";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { rLanguage } from "./r-language";
import { rHoverTooltip } from "./hover";
import { defaultCatalog } from "./catalog";
import { lspExtensions } from "./lsp/extension";
import { selectDecorations, type SelectDecorationSpec } from "./decorations";
import { buildUnifiedMerge, type MergeResolveEvent } from "./merge";
import type { Catalog, EditorInstance, MountOptions } from "./types";

const forgeTheme = EditorView.baseTheme({
  ".cm-forge-info": { padding: "2px 0", maxWidth: "32rem" },
  ".cm-forge-sig": { fontFamily: "monospace", fontWeight: "bold", marginBottom: "2px" },
  ".cm-forge-doc": { fontSize: "90%", opacity: "0.85", whiteSpace: "normal" },
  ".cm-forge-select": {
    font: "inherit",
    padding: "0 1px",
    margin: "0",
    verticalAlign: "baseline",
  },
});

/** Construct a CodeMirror editor and return the host-facing handle. */
export function createEditor(parent: HTMLElement, opts: MountOptions = {}): EditorInstance {
  const catalog: Catalog = opts.catalog ?? defaultCatalog;
  const listeners = new Set<(code: string) => void>();
  if (opts.onChange) listeners.add(opts.onChange);

  const mergeResolveListeners = new Set<(e: MergeResolveEvent) => void>();
  if (opts.onMergeResolve) mergeResolveListeners.add(opts.onMergeResolve);

  const decorationsCompartment = new Compartment();
  const mergeCompartment = new Compartment();

  // Merge session state. A merge is opened by `setValue(code, { merge: true })`
  // and resolves once every chunk has been accepted or rejected, at which point
  // the merge view is torn down and `mergeResolveListeners` fire once.
  let merging = false;
  let mergeOriginal: string | null = null;
  let accepted = 0;
  let rejected = 0;

  const finishMerge = (finalCode: string) => {
    // Guard against a double resolve: e.g. `rejectAllChanges()` dispatches a
    // revert that drives the doc back to the original, which itself trips the
    // updateListener's "no chunks left" auto-resolve. Whichever fires first wins.
    if (!merging) return;
    merging = false;
    mergeOriginal = null;
    const summary: MergeResolveEvent = { code: finalCode, accepted, rejected };
    // Dispatch (reconfigure) cannot run inside an updateListener, so defer.
    queueMicrotask(() => {
      view.dispatch({ effects: mergeCompartment.reconfigure([]) });
      for (const cb of mergeResolveListeners) cb(summary);
      // Re-sync onChange/_code once after gating during the merge.
      for (const cb of listeners) cb(finalCode);
    });
  };

  const extensions = [
    basicSetup,
    rLanguage(catalog),
    rHoverTooltip(catalog),
    forgeTheme,
    EditorView.updateListener.of((update) => {
      if (merging) {
        for (const tr of update.transactions) {
          if (tr.isUserEvent("accept")) accepted++;
          else if (tr.isUserEvent("revert")) rejected++;
        }
        const chunks = getChunks(update.state)?.chunks ?? [];
        if (chunks.length === 0) finishMerge(update.state.doc.toString());
        return; // gate normal onChange while merging
      }
      if (!update.docChanged) return;
      const code = update.state.doc.toString();
      for (const cb of listeners) cb(code);
    }),
  ];
  if (opts.readOnly) extensions.push(EditorState.readOnly.of(true));
  if (opts.theme === "dark") extensions.push(oneDark);

  extensions.push(
    decorationsCompartment.of(
      opts.decorations?.length ? selectDecorations(opts.decorations) : [],
    ),
  );
  extensions.push(mergeCompartment.of([]));

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
    setValue: (code: string, setOpts?: { merge?: boolean }) => {
      const current = view.state.doc.toString();
      if (setOpts?.merge && code !== current) {
        mergeOriginal = current;
        merging = true;
        accepted = 0;
        rejected = 0;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: code },
          effects: mergeCompartment.reconfigure(buildUnifiedMerge(current)),
        });
        return;
      }
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: code },
        effects: merging ? mergeCompartment.reconfigure([]) : [],
      });
      merging = false;
      mergeOriginal = null;
    },
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onMergeResolve: (cb) => {
      mergeResolveListeners.add(cb);
      return () => mergeResolveListeners.delete(cb);
    },
    isMerging: () => merging,
    acceptAllChanges: () => {
      if (!merging) return;
      const remaining = getChunks(view.state)?.chunks.length ?? 0;
      accepted += remaining;
      // The document already holds the "new" side, so keep it as-is.
      finishMerge(view.state.doc.toString());
    },
    rejectAllChanges: () => {
      if (!merging || mergeOriginal == null) return;
      const remaining = getChunks(view.state)?.chunks.length ?? 0;
      rejected += remaining;
      const original = mergeOriginal;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: original },
      });
      finishMerge(original);
    },
    setDecorations: (specs: ReadonlyArray<SelectDecorationSpec>) => {
      view.dispatch({
        effects: decorationsCompartment.reconfigure(
          specs.length ? selectDecorations(specs) : [],
        ),
      });
    },
    focus: () => view.focus(),
    destroy: () => {
      view.destroy();
      if (lspWiring) lspWiring.dispose();
    },
  };
}
