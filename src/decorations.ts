import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

/** One `<option>` for a {@link SelectDecorationSpec}; a bare string is used as both value and label. */
export type SelectOption = string | { value: string; label?: string };

/** Configuration for one inline `<select>` decoration. */
export interface SelectDecorationSpec {
  /** Regex matched against the document text. The `g` flag is added automatically if missing. */
  pattern: RegExp;
  /** Returns the `<option>`s for a given match. */
  options: (match: RegExpExecArray) => ReadonlyArray<SelectOption>;
}

interface NormalizedSpec {
  pattern: RegExp;
  options: SelectDecorationSpec["options"];
}

interface PluginHandle {
  decorations: DecorationSet;
}

function normalizeOption(o: SelectOption): { value: string; label: string } {
  return typeof o === "string"
    ? { value: o, label: o }
    : { value: o.value, label: o.label ?? o.value };
}

function withGlobalFlag(re: RegExp): RegExp {
  return re.global ? re : new RegExp(re.source, re.flags + "g");
}

class SelectWidget extends WidgetType {
  constructor(
    readonly value: string,
    readonly spec: NormalizedSpec,
    readonly match: RegExpExecArray,
    readonly plugin: PluginHandle,
  ) {
    super();
  }

  eq(other: SelectWidget): boolean {
    return other.value === this.value && other.spec === this.spec;
  }

  // Keep mouse/keyboard interaction inside the <select>; don't let CM treat it as editor input.
  ignoreEvent(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const select = document.createElement("select");
    select.className = "cm-forge-select";

    const options = this.spec.options(this.match).map(normalizeOption);
    let matched = false;
    for (const o of options) {
      const optEl = document.createElement("option");
      optEl.value = o.value;
      optEl.textContent = o.label;
      if (!matched && o.value === this.value) {
        optEl.selected = true;
        matched = true;
      }
      select.appendChild(optEl);
    }
    if (!matched && select.firstElementChild) {
      (select.firstElementChild as HTMLOptionElement).selected = true;
    }

    select.addEventListener("change", () => {
      const pos = view.posAtDOM(select);
      const iter = this.plugin.decorations.iter();
      while (iter.value) {
        if (iter.from <= pos && pos < iter.to) {
          view.dispatch({
            changes: { from: iter.from, to: iter.to, insert: select.value },
          });
          return;
        }
        iter.next();
      }
    });

    return select;
  }
}

function build(text: string, specs: NormalizedSpec[], plugin: PluginHandle): DecorationSet {
  type Hit = { from: number; to: number; widget: SelectWidget };
  const hits: Hit[] = [];

  for (const spec of specs) {
    spec.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = spec.pattern.exec(text))) {
      if (m[0].length === 0) {
        // Avoid infinite loops on zero-length matches.
        spec.pattern.lastIndex++;
        continue;
      }
      const from = m.index;
      const to = from + m[0].length;
      let overlaps = false;
      for (const h of hits) {
        if (!(to <= h.from || from >= h.to)) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      hits.push({ from, to, widget: new SelectWidget(m[0], spec, m, plugin) });
    }
  }

  hits.sort((a, b) => a.from - b.from);
  const builder = new RangeSetBuilder<Decoration>();
  for (const h of hits) {
    builder.add(h.from, h.to, Decoration.replace({ widget: h.widget }));
  }
  return builder.finish();
}

/**
 * Build a CodeMirror extension that renders an inline `<select>` widget at every match of every
 * spec. Picking an `<option>` rewrites the matched range in the document with the new value; as
 * long as the pattern still matches that new value, the widget reappears with the new selection.
 */
export function selectDecorations(specs: ReadonlyArray<SelectDecorationSpec>): Extension {
  const normalized: NormalizedSpec[] = specs.map((s) => ({
    pattern: withGlobalFlag(s.pattern),
    options: s.options,
  }));

  return ViewPlugin.fromClass(
    class implements PluginHandle {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = build(view.state.doc.toString(), normalized, this);
      }

      update(u: ViewUpdate) {
        if (u.docChanged) {
          this.decorations = build(u.state.doc.toString(), normalized, this);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}
