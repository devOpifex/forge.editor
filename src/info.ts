import type { CompletionItem } from "./types";

/**
 * Build the DOM shown in completion popups and hover tooltips: a bold
 * monospace signature line followed by the short description.
 */
export function renderInfo(item: CompletionItem): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-forge-info";

  const sig = document.createElement("div");
  sig.className = "cm-forge-sig";
  sig.textContent = item.signature ?? item.name;
  dom.appendChild(sig);

  if (item.doc) {
    const doc = document.createElement("div");
    doc.className = "cm-forge-doc";
    doc.textContent = item.doc;
    dom.appendChild(doc);
  }
  return dom;
}
