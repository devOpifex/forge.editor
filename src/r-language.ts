import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import { r } from "@codemirror/legacy-modes/mode/r";
import type { Catalog } from "./types";
import { rCompletionSource } from "./completion";

/**
 * R language support: stream-based syntax highlighting wired to a catalog-backed
 * autocomplete source via CodeMirror language data.
 */
export function rLanguage(catalog: Catalog): LanguageSupport {
  const lang = StreamLanguage.define(r);
  return new LanguageSupport(lang, [
    lang.data.of({ autocomplete: rCompletionSource(catalog) }),
  ]);
}
