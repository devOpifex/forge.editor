library(shiny)
library(forge.editor)

ui <- fluidPage(
  titlePanel("forge.editor — LSP demo"),
  fluidRow(
    column(
      8,
      forgeEditorOutput("ed", height = "500px"),
      tags$p(
        "Type ", tags$code("dplyr::fil"), " to test LSP completion, hover over ",
        tags$code("filter"), " for live docs, and introduce a syntax error to see ",
        "a diagnostic appear (poll interval ~1.5s)."
      )
    ),
    column(
      4,
      tags$h4("Editor contents"),
      verbatimTextOutput("code")
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
        "  ",
        sep = "\n"
      ),
      theme = "dark",
      lsp = TRUE
    )
  })

  output$code <- renderText({
    input$ed_code %||% ""
  })
}

shinyApp(ui, server)
