#' Mount an in-browser R code editor
#'
#' Creates an htmlwidget hosting the forge.editor CodeMirror 6 instance.
#' When called inside a Shiny session with `lsp = TRUE`, a per-session
#' R `languageserver` subprocess is spawned and exposed as a JSON-RPC over
#' HTTP endpoint so the editor can request real completion, hover, and
#' diagnostic information. Outside Shiny (or when `languageserver` is not
#' installed) the editor falls back silently to the bundled static catalog.
#'
#' @param value Initial document contents.
#' @param theme One of `"light"` or `"dark"`.
#' @param readOnly If `TRUE`, the editor renders read-only.
#' @param catalog Optional named list mirroring the JS `Catalog` shape:
#'   `list(pkgname = list(list(name = "fn", signature = "...", doc = "...")))`.
#'   Overrides the bundled default catalog.
#' @param lsp Either `FALSE` (default), `TRUE`, or a named list of LSP
#'   options forwarded to the JS client (`rootUri`, `documentUri`,
#'   `languageId`, `pollIntervalMs`). Only honoured inside Shiny.
#' @param width,height Widget dimensions, passed through to htmlwidgets.
#' @param elementId Optional explicit DOM id for the widget container.
#'
#' @export
forge_editor <- function(
  value = "",
  theme = c("light", "dark"),
  readOnly = FALSE,
  catalog = NULL,
  lsp = FALSE,
  width = NULL,
  height = NULL,
  elementId = NULL
) {
  theme <- match.arg(theme)

  x <- list(
    value = value,
    theme = theme,
    readOnly = isTRUE(readOnly)
  )
  if (!is.null(catalog)) {
    x$catalog <- catalog
  }

  lsp_opts <- resolve_lsp_options(lsp)
  if (!is.null(lsp_opts)) {
    session <- shiny::getDefaultReactiveDomain()
    if (!is.null(session)) {
      url <- tryCatch(
        start_lsp_bridge(session),
        error = function(e) {
          warning(
            "forge.editor: failed to start LSP bridge (",
            conditionMessage(e),
            "); falling back to static catalog.",
            call. = FALSE
          )
          NULL
        }
      )
      if (!is.null(url)) {
        lsp_opts$url <- url
        x$lsp <- lsp_opts
      }
    }
  }

  htmlwidgets::createWidget(
    name = "forgeEditor",
    x = x,
    width = width,
    height = height,
    package = "forge.editor",
    elementId = elementId,
    sizingPolicy = htmlwidgets::sizingPolicy(
      defaultWidth = "100%",
      defaultHeight = 400,
      viewer.fill = TRUE,
      browser.fill = TRUE,
      knitr.figure = FALSE
    )
  )
}

#' Shiny output binding for forge_editor
#' @param outputId Output slot ID.
#' @param width,height Widget dimensions.
#' @export
forgeEditorOutput <- function(outputId, width = "100%", height = "400px") {
  htmlwidgets::shinyWidgetOutput(
    outputId,
    "forgeEditor",
    width,
    height,
    package = "forge.editor"
  )
}

#' Shiny render binding for forge_editor
#' @param expr A `forge_editor()` call.
#' @param env Environment to evaluate `expr` in.
#' @param quoted Whether `expr` is already quoted.
#' @export
renderForgeEditor <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, forgeEditorOutput, env, quoted = TRUE)
}

resolve_lsp_options <- function(lsp) {
  if (isFALSE(lsp) || is.null(lsp)) {
    return(NULL)
  }
  if (isTRUE(lsp)) {
    return(list())
  }
  if (is.list(lsp)) {
    return(lsp)
  }
  stop("`lsp` must be TRUE, FALSE, or a named list.", call. = FALSE)
}
