import { createEditor } from "./editor";
import type { EditorInstance, MountOptions } from "./types";

export type { Catalog, CompletionItem, EditorInstance, MountOptions } from "./types";
export { defaultCatalog, mergeCatalogs } from "./catalog";

/**
 * Mount an R code editor into `el`.
 *
 * @example
 * import { mount } from "forge.editor";
 * const ed = mount(document.getElementById("app")!, { value: "x <- 1" });
 * ed.getValue();
 */
export function mount(el: HTMLElement, opts?: MountOptions): EditorInstance {
  return createEditor(el, opts);
}
