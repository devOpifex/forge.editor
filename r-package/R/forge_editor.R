#' Mount an in-browser R code editor
#'
#' Creates an htmlwidget hosting the forge.editor CodeMirror 6 instance.
#' When called inside a Shiny session with `lsp = TRUE`, a per-session
#' R `languageserver` subprocess is spawned the first time each editor
#' connects, and JSON-RPC traffic is tunnelled over the existing Shiny
#' WebSocket (no extra HTTP endpoint, no polling). Outside Shiny (or when
#' `languageserver` is not installed) the editor falls back silently to
#' the bundled static catalog.
#'
#' @param value Initial document contents.
#' @param theme One of `"light"` or `"dark"`.
#' @param readOnly If `TRUE`, the editor renders read-only.
#' @param catalog Optional named list mirroring the JS `Catalog` shape:
#'   `list(pkgname = list(list(name = "fn", signature = "...", doc = "...")))`.
#'   Overrides the bundled default catalog.
#' @param lsp Either `FALSE` (default), `TRUE`, or a named list of LSP
#'   options forwarded to the JS client (`rootUri`, `documentUri`,
#'   `languageId`). Only honoured inside Shiny.
#' @param decorations Optional list of inline `<select>` widget specs. Each
#'   entry is most easily built with [forge_decoration()]; see that function
#'   for the expected shape. The same specs can also be applied from JS at
#'   runtime via the widget instance's `setDecorations` method.
#' @param width,height Widget dimensions, passed through to htmlwidgets.
#' @param elementId Optional explicit DOM id for the widget container. When
#'   `lsp` is enabled, the same id is used to namespace the Shiny
#'   input/custom-message channels, so each editor on the page gets its own
#'   `languageserver` subprocess.
#'
#' @export
forge_editor <- function(
  value = "",
  theme = c("light", "dark"),
  readOnly = FALSE,
  catalog = NULL,
  lsp = FALSE,
  decorations = NULL,
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

  decorations <- normalize_decorations(decorations)
  if (!is.null(decorations)) {
    x$decorations <- decorations
  }

  lsp_opts <- resolve_lsp_options(lsp)
  if (!is.null(lsp_opts)) {
    session <- shiny::getDefaultReactiveDomain()
    if (!is.null(session)) {
      tryCatch(
        ensure_lsp_init_observer(session),
        error = function(e) {
          warning(
            "forge.editor: failed to install LSP init observer (",
            conditionMessage(e),
            "); falling back to static catalog.",
            call. = FALSE
          )
        }
      )
      # The JS bundle reads `x$lsp` and, if present, opens a ShinyTransport
      # using `el.id` (or `lsp$elementId`) as the channel prefix. The R-side
      # subprocess is spawned lazily when the browser fires the init message.
      lsp_opts$enabled <- TRUE
      x$lsp <- lsp_opts
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

#' Update a rendered forge_editor without re-rendering
#'
#' Pushes new contents to an editor that is already on the page, without
#' re-running [forge_editor()]. The document is replaced via a single
#' CodeMirror transaction, so the selection, scroll position, undo history and
#' any live LSP connection are preserved. Only the document `code` can be
#' updated for now.
#'
#' @param id The output id of the editor to update (the `outputId` passed to
#'   [forgeEditorOutput()] / used with [renderForgeEditor()]).
#' @param code New document contents. If `NULL`, no change is sent.
#' @param session The Shiny session; defaults to the current reactive domain.
#'
#' @export
updateForgeEditor <- function(
  id,
  code = NULL,
  session = shiny::getDefaultReactiveDomain()
) {
  if (is.null(session)) {
    stop(
      "`updateForgeEditor()` must be called within a Shiny session.",
      call. = FALSE
    )
  }
  message <- list(id = session$ns(id))
  if (!is.null(code)) {
    message$code <- code
  }
  session$sendCustomMessage("forgeEditor:update", message)
  invisible()
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

#' Build one inline `<select>` decoration spec
#'
#' Convenience helper that produces a list shaped for the JS client's
#' decoration API. Pass any number of these in via the `decorations` argument
#' to [forge_editor()].
#'
#' When the editor scans the document, every match of `pattern` is replaced by
#' a `<select>` whose `<option>`s come from `options`. The option whose
#' `value` equals the matched text is pre-selected; picking another option
#' rewrites the matched range in the document with the new value.
#'
#' @param pattern A regular expression string (JavaScript regex syntax).
#' @param options A non-empty list of `list(value = ..., label = ...)` entries
#'   describing the `<option>`s.
#' @param flags Optional JS regex flag string (e.g. `"i"`). The `g` flag is
#'   added automatically by the JS client.
#'
#' @examples
#' forge_decoration(
#'   pattern = '"(red|green|blue)"',
#'   options = list(
#'     list(value = '"red"',   label = "red"),
#'     list(value = '"green"', label = "green"),
#'     list(value = '"blue"',  label = "blue")
#'   )
#' )
#'
#' @export
forge_decoration <- function(pattern, options, flags = "") {
  if (!is.character(pattern) || length(pattern) != 1L || is.na(pattern)) {
    stop("`pattern` must be a single non-NA character string.", call. = FALSE)
  }
  if (!is.character(flags) || length(flags) != 1L || is.na(flags)) {
    stop("`flags` must be a single non-NA character string.", call. = FALSE)
  }
  if (!is.list(options) || length(options) == 0L) {
    stop("`options` must be a non-empty list of list(value, label) entries.", call. = FALSE)
  }
  for (i in seq_along(options)) {
    o <- options[[i]]
    if (!is.list(o) || is.null(o$value) || is.null(o$label)) {
      stop(
        sprintf("`options[[%d]]` must be list(value = ..., label = ...).", i),
        call. = FALSE
      )
    }
  }
  list(pattern = pattern, flags = flags, options = options)
}

normalize_decorations <- function(decorations) {
  if (is.null(decorations)) {
    return(NULL)
  }
  if (!is.list(decorations)) {
    stop("`decorations` must be a list of decoration specs.", call. = FALSE)
  }
  # Accept a single spec passed without an outer list().
  if (!is.null(decorations$pattern) && !is.null(decorations$options)) {
    decorations <- list(decorations)
  }
  for (i in seq_along(decorations)) {
    s <- decorations[[i]]
    if (!is.list(s) || is.null(s$pattern) || is.null(s$options)) {
      stop(
        sprintf("`decorations[[%d]]` must have `pattern` and `options` fields.", i),
        call. = FALSE
      )
    }
    if (is.null(s$flags)) {
      decorations[[i]]$flags <- ""
    }
  }
  decorations
}
