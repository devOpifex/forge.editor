# forge.editor

In-browser R code editor built on [CodeMirror 6](https://codemirror.net/). Ships
as a plain ESM library so any host program can embed it, hand it code, and read
code back. Features R syntax highlighting, package-aware autocomplete, and hover
documentation driven by a static metadata catalog (no running R required).

## Install & build

```bash
npm install      # install dependencies
npm run dev      # open the demo playground (Vite)
npm run build    # emit dist/forge.editor.js + dist/index.d.ts
npm test         # run unit tests (Vitest)
```

## Usage

```ts
import { mount } from "forge.editor";

const ed = mount(document.getElementById("editor")!, {
  value: "x <- 1",          // initial code
  // catalog: myCatalog,    // optional: override the bundled metadata
  // theme: "dark",
  // readOnly: false,
  onChange: (code) => console.log(code),
});

ed.getValue();              // retrieve current code
ed.setValue("y <- 2");      // replace the document
const off = ed.onChange((c) => save(c));
off();                      // unsubscribe
ed.destroy();               // tear down
```

## Autocomplete & hover metadata

Suggestions and hover docs come from a **catalog** keyed by package name. The
bundled default lives in [`data/catalog.json`](data/catalog.json); the shape is
defined by `Catalog` / `CompletionItem` in [`src/types.ts`](src/types.ts):

```json
{
  "dplyr": [
    { "name": "filter", "type": "function",
      "signature": "filter(.data, ...)", "doc": "Keep rows that match a condition." }
  ]
}
```

- Typing a bare identifier offers the union of all packages' symbols.
- Typing `pkg::` scopes suggestions to that package (mirrors R).
- Hovering a known symbol shows its signature and description.

A host can supply its own catalog at runtime via `mount(el, { catalog })`, or
merge several with `mergeCatalogs(...)`.

### Regenerating the catalog from installed R packages

`tools/extract-metadata.R` introspects installed packages (exports, signatures
from `formals()`, and help-page titles) and writes the JSON catalog:

```bash
npm run gen:catalog -- dplyr forge.internal      # -> data/catalog.json
Rscript tools/extract-metadata.R --out custom.json pkgA pkgB
```

Requires R with the target packages and `jsonlite` installed. The format also
allows hand-authoring entries for internal packages.

## Inline `<select>` decorations

The editor can render an interactive `<select>` widget at every match of a
regex you provide. Picking an option rewrites the matched range in the
document; as long as the pattern still matches the new value, the widget
reappears with the new selection.

```ts
import { mount, type SelectDecorationSpec } from "forge.editor";

const colorPicker: SelectDecorationSpec = {
  pattern: /"(red|green|blue)"/,                  // `g` flag added if missing
  options: (match) => [                           // called per match
    { value: '"red"',   label: "red" },
    { value: '"green"', label: "green" },
    { value: '"blue"',  label: "blue" },
  ],
};

const ed = mount(el, {
  value: 'color <- "red"',
  decorations: [colorPicker],
});

// Swap (or clear) the active spec list at runtime:
ed.setDecorations([colorPicker, otherSpec]);
ed.setDecorations([]);                            // clear all
```

- `pattern` is matched against the full document text. The match's text is
  pre-selected if it equals one of the option `value`s; otherwise the first
  option wins.
- `options` is called with the `RegExpExecArray` for each match, so callbacks
  can vary the option list per match (e.g. via capture groups).
- Options may be plain strings (`"red"`, used as both value and label) or
  `{ value, label }` objects.
- When two patterns would match overlapping ranges, the spec listed first
  wins.

## Out of scope (for now)

Linting/diagnostics, auto-formatting, signature help, and live R-backed
completions are not included. The catalog is injectable, so a live backend can
later be layered behind the same `mount` API.
```
