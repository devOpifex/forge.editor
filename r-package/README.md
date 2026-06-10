# forge.editor

In-browser R code editor (CodeMirror 6) packaged as an htmlwidget. Drops into
RStudio Viewer, R Markdown, and Shiny apps with one call. Inside a Shiny
session it can be wired to the R `{languageserver}` package for live, project-
aware completion, hover docs, and diagnostics.

## Installation

The package lives in the `r-package/` subdirectory of the
[forge.editor](https://github.com/devOpifex/forge.editor) repo, so install with
`pak` using a subdirectory spec:

```r
# install.packages("pak")
pak::pak("devOpifex/forge.editor/r-package")
```

For LSP support also install:

```r
pak::pak("languageserver")
```

## Example

```r
library(shiny)
library(forge.editor)

ui <- fluidPage(
  forgeEditorOutput("ed", height = "500px"),
  verbatimTextOutput("code")
)

server <- function(input, output, session) {
  output$ed <- renderForgeEditor({
    forge_editor(
      value = "library(dplyr)\n\nmtcars |>\n  filter(mpg > 20) |>\n  ",
      theme = "dark",
      lsp = TRUE
    )
  })

  output$code <- renderText({
    input$ed_code %||% ""
  })
}

shinyApp(ui, server)
```

`input$<id>_code` (`input$ed_code` above) updates as the user edits.

The same call works outside Shiny — e.g. in RStudio Viewer or knitted into an
HTML document — but without `lsp = TRUE`, since there is no Shiny session to
host the language-server bridge.

```r
forge.editor::forge_editor(value = "1 + 1")
```

## Merge / diff view

Instead of overwriting the editor outright, `updateForgeEditor()` can present new
contents as a **unified diff** with inline Accept/Reject buttons per change, by
passing `merge = TRUE`. The user resolves each chunk; once all are resolved the
merge view disappears and the final document is reported back on
`input$<id>_merge` as `list(code, accepted, rejected)`:

```r
ui <- fluidPage(
  forgeEditorOutput("ed", height = "500px"),
  actionButton("suggest", "Suggest rewrite"),
  verbatimTextOutput("merge")
)

server <- function(input, output, session) {
  output$ed <- renderForgeEditor({
    forge_editor(value = "mtcars |> filter(mpg > 20)")
  })

  observeEvent(input$suggest, {
    updateForgeEditor(
      "ed",
      code = "mtcars |>\n  filter(mpg > 20) |>\n  select(mpg, cyl)",
      merge = TRUE
    )
  })

  # Fires once the user has accepted/rejected every chunk.
  observeEvent(input$ed_merge, {
    str(input$ed_merge) # list(code = "...", accepted = 1, rejected = 0)
  })
}
```

Resolve a merge programmatically with `updateForgeEditor("ed", action = "acceptAll")`
or `action = "rejectAll"`.

To pick the result up under a different input name (or run extra logic in the
browser), supply an `onMerge` callback to `forge_editor()`:

```r
forge_editor(
  value = "1 + 1",
  onMerge = htmlwidgets::JS(
    "function(e, id) { Shiny.setInputValue(id + '_applied', e.code, {priority: 'event'}); }"
  )
)
```

## Inline `<select>` decorations

`forge_editor()` accepts a `decorations` argument: a list of inline `<select>`
widget specs. Every match of a spec's regex is replaced by a `<select>` whose
`<option>`s come from the spec. Picking a different option rewrites the
matched range in the source — so as long as the regex also matches the new
value, the widget stays in place with the new selection.

Build each spec with `forge_decoration()`:

```r
forge_editor(
  value = 'color <- "red"',
  decorations = list(
    forge_decoration(
      pattern = '"(red|green|blue)"',
      options = list(
        list(value = '"red"',   label = "red"),
        list(value = '"green"', label = "green"),
        list(value = '"blue"',  label = "blue")
      )
    )
  )
)
```

- `pattern` is a JS regex string. The `g` flag is added automatically; pass
  others via `flags = "i"` etc.
- Each option is `list(value = ..., label = ...)`. The option whose `value`
  equals the matched text is pre-selected; otherwise the first option wins.
- Multiple specs may be passed; if two patterns match overlapping ranges, the
  one listed first wins.

The same specs can also be applied from JS at runtime via the widget
instance's `setDecorations` method:

```js
HTMLWidgets.find("#ed").setDecorations([
  { pattern: '"(red|green|blue)"',
    options: [{ value: '"red"', label: "red" } /* ... */] }
]);
```

### Dynamic / async options (`fetch()`)

`forge_decoration()` only carries a **static** option list — an R list can't
hold a JS callback. To load options dynamically (e.g. from an HTTP endpoint),
set `options` to a JS **function** via the `setDecorations` method. It receives
the match and may return an array or a `Promise` resolving to one:

```js
HTMLWidgets.find("#ed").setDecorations([
  {
    pattern: 'dataset\\("([^"]*)"\\)',
    options: async function (match) {
      const res = await fetch("/api/datasets?q=" + encodeURIComponent(match[1]));
      const names = await res.json();
      return names.map((n) => ({ value: 'dataset("' + n + '")', label: n }));
    },
  },
]);
```

While the promise resolves, the `<select>` shows the matched text and is
disabled, then fills in once the options arrive. The function runs when the
widget first mounts and whenever the matched value changes — not on every
keystroke — so identical fetches won't fire repeatedly as the user types
elsewhere. See the JS library's [README](../README.md#inline-select-decorations)
for the underlying behavior.

A larger working example lives in [`inst/examples/shiny-demo/app.R`](inst/examples/shiny-demo/app.R).
