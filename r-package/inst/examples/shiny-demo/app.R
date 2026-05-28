library(shiny)
library(bslib)
library(forge.editor)

ui <- page_sidebar(
  title = "forge.editor — LSP + decorations demo",
  theme = bs_theme(preset = "darkly"),
  fillable = TRUE,
  sidebar = sidebar(
    position = "right",
    width = 360,
    title = "Editor contents",
    verbatimTextOutput("code")
  ),
  card(
    full_screen = TRUE,
    card_header("Editor"),
    forgeEditorOutput("ed", height = "100%")
  ),
  card(
    card_body(
      tags$p(
        "Type ",
        tags$code("dplyr::fil"),
        " to test LSP completion, hover over ",
        tags$code("filter"),
        " for live docs, and introduce a syntax error to see ",
        "a diagnostic appear (pushed over the Shiny WebSocket — no polling)."
      ),
      tags$p(
        "The ", tags$code("mtcars"), " column name and the comparison operator ",
        "inside ", tags$code("filter()"), " are rendered as inline ",
        tags$code("<select>"), " dropdowns. Pick a different option and the ",
        "source is rewritten in place."
      )
    )
  )
)

server <- function(input, output, session) {
  output$ed <- renderForgeEditor({
    forge_editor(
      value = paste(
        "library(dplyr)",
        "",
        "mtcars |>",
        "  filter(mpg > 20) |>",
        "  arrange(cyl)",
        sep = "\n"
      ),
      theme = "dark",
      lsp = TRUE,
      decorations = list(
        # `mtcars` column names anywhere in the code become a picker.
        forge_decoration(
          pattern = "\\b(mpg|cyl|disp|hp|drat|wt|qsec|vs|am|gear|carb)\\b",
          options = list(
            list(value = "mpg",  label = "mpg"),
            list(value = "cyl",  label = "cyl"),
            list(value = "disp", label = "disp"),
            list(value = "hp",   label = "hp"),
            list(value = "wt",   label = "wt"),
            list(value = "gear", label = "gear")
          )
        ),
        # Comparison operator inside `filter()` — lookarounds keep the
        # surrounding spaces out of the matched range so swaps stay tidy.
        forge_decoration(
          pattern = "(?<=\\s)(>=|<=|==|!=|>|<)(?=\\s)",
          options = list(
            list(value = ">",  label = ">"),
            list(value = "<",  label = "<"),
            list(value = ">=", label = ">="),
            list(value = "<=", label = "<="),
            list(value = "==", label = "=="),
            list(value = "!=", label = "!=")
          )
        )
      )
    )
  })

  output$code <- renderText({
    input$ed_code %||% ""
  })
}

shinyApp(ui, server)
