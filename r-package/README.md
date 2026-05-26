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
