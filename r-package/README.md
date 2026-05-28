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

A larger working example lives in [`inst/examples/shiny-demo/app.R`](inst/examples/shiny-demo/app.R).
