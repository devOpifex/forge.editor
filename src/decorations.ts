import {
  type Extension,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";

/** One `<option>` for a {@link SelectDecorationSpec}; a bare string is used as both value and label. */
export type SelectOption = string | { value: string; label?: string };

/** Options for a match, resolved synchronously or asynchronously (e.g. via `fetch()`). */
export type SelectOptionsResult =
  | ReadonlyArray<SelectOption>
  | Promise<ReadonlyArray<SelectOption>>;

/** Configuration for one inline `<select>` decoration. */
export interface SelectDecorationSpec {
  /** Regex matched against the document text. The `g` flag is added automatically if missing. */
  pattern: RegExp;
  /**
   * Returns the `<option>`s for a given match. May return a Promise (e.g. from `fetch()`); while it
   * resolves, the widget shows the matched text and is disabled, then fills in once the options
   * arrive. Called when the widget first mounts and whenever the matched value changes.
   */
  options: (match: RegExpExecArray) => SelectOptionsResult;
}

interface NormalizedSpec {
  pattern: RegExp;
  options: SelectDecorationSpec["options"];
  /** True when `value` is matched in full by the pattern (used to gate the first-option default). */
  matches: (value: string) => boolean;
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
    readonly field: StateField<DecorationSet>,
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

    // Locate this widget's range in the document and replace it with `value`.
    const commit = (value: string) => {
      const pos = view.posAtDOM(select);
      const iter = view.state.field(this.field).iter();
      while (iter.value) {
        if (iter.from <= pos && pos < iter.to) {
          view.dispatch({
            changes: { from: iter.from, to: iter.to, insert: value },
          });
          return;
        }
        iter.next();
      }
    };

    const fill = (raw: ReadonlyArray<SelectOption>) => {
      const options = raw.map(normalizeOption);
      select.replaceChildren();
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
        const first = select.firstElementChild as HTMLOptionElement;
        first.selected = true;
        // The matched text isn't one of the options (e.g. the user just typed the
        // decorator). Commit the first option so the document agrees with what the
        // widget shows — but only when that value still matches the pattern in full,
        // so the rewrite can't drop the widget or loop. Deferred via a microtask
        // because we can't dispatch a transaction during a view update.
        if (this.spec.matches(first.value)) {
          queueMicrotask(() => {
            if (select.isConnected) commit(first.value);
          });
        }
      }
    };

    const result = this.spec.options(this.match);
    if (result instanceof Promise) {
      // Show the matched text and lock the control until the options arrive.
      const pending = document.createElement("option");
      pending.value = this.value;
      pending.textContent = this.value;
      pending.selected = true;
      select.appendChild(pending);
      select.disabled = true;
      result.then(
        (options) => {
          select.disabled = false;
          fill(options);
        },
        () => {
          // Leave the matched text in place but re-enable so the user isn't stuck.
          select.disabled = false;
        },
      );
    } else {
      fill(result);
    }

    select.addEventListener("change", () => commit(select.value));

    return select;
  }
}

function build(
  text: string,
  specs: NormalizedSpec[],
  field: StateField<DecorationSet>,
): DecorationSet {
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
      hits.push({ from, to, widget: new SelectWidget(m[0], spec, m, field) });
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
  const normalized: NormalizedSpec[] = specs.map((s) => {
    // A non-global, fully-anchored clone: tells us whether a candidate value is a
    // complete match (so committing it leaves the widget intact rather than dropping
    // or growing it). Kept separate from the global `pattern` used to scan the doc.
    const full = new RegExp(`^(?:${s.pattern.source})$`, s.pattern.flags.replace("g", ""));
    return {
      pattern: withGlobalFlag(s.pattern),
      options: s.options,
      matches: (value: string) => full.test(value),
    };
  });

  const field: StateField<DecorationSet> = StateField.define<DecorationSet>({
    create(state) {
      return build(state.doc.toString(), normalized, field);
    },
    update(deco, tr) {
      if (tr.docChanged) {
        return build(tr.state.doc.toString(), normalized, field);
      }
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return field;
}
