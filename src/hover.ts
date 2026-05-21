import { hoverTooltip } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { Catalog } from "./types";
import { findItem } from "./catalog";
import { renderInfo } from "./info";

const WORD_CHAR = /[\w.]/;

/** Identifier surrounding `pos`, with absolute document offsets. */
function wordAt(text: string, lineFrom: number, pos: number) {
  let start = pos - lineFrom;
  let end = start;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
  while (end < text.length && WORD_CHAR.test(text[end])) end++;
  return { from: lineFrom + start, to: lineFrom + end, text: text.slice(start, end) };
}

/** Hover tooltip that shows a known symbol's signature and description. */
export function rHoverTooltip(catalog: Catalog): Extension {
  return hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const word = wordAt(line.text, line.from, pos);
    if (!word.text) return null;

    // Honour a `pkg::` qualifier appearing just before the symbol.
    const before = line.text.slice(0, word.from - line.from);
    const pkg = /([A-Za-z.][\w.]*):{2,3}$/.exec(before)?.[1];

    const item = findItem(catalog, word.text, pkg);
    if (!item) return null;

    return {
      pos: word.from,
      end: word.to,
      above: true,
      create() {
        return { dom: renderInfo(item) };
      },
    };
  });
}
