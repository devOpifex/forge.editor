# Non-blocking, per-editor bridge to an R `languageserver` subprocess that
# piggy-backs on the Shiny WebSocket.
#
# Each browser-side editor calls `Shiny.setInputValue("forge_editor_lsp_init",
# <elementId>, {priority: "event"})` once after mount. The session-scoped
# init observer (installed by `ensure_lsp_init_observer`) reacts to that and
# calls `start_lsp_bridge(session, element_id)`, which:
#
#   * spawns an `Rscript -e 'languageserver::run()'` subprocess via processx,
#   * registers an `observeEvent` on `input[[paste0(element_id, "_lsp_send")]]`
#     that writes each browser-originated JSON-RPC frame to the subprocess
#     stdin, and
#   * schedules a `later::later` pump that drains the subprocess stdout for
#     complete LSP frames and pushes them to the browser as raw JSON strings
#     via `session$sendCustomMessage(paste0(element_id, "_lsp_recv"), ...)`.
#
# Neither leg blocks: the observer fires when Shiny delivers an event, the
# pump returns immediately after each non-blocking `read_output()` and
# reschedules itself, and JSON-RPC ids are paired by the LSP client in the
# browser, so the bridge never needs to wait for a matching response.

# Per-session top-level state, keyed by `session$token`.
#   $init_installed  TRUE once `ensure_lsp_init_observer` has registered the
#                    init observer for this session.
#   $bridges         env keyed by element_id, holding per-editor state.
.lsp_state <- new.env(parent = emptyenv())

LSP_INIT_INPUT <- "forge_editor_lsp_init"
PUMP_INTERVAL <- 0.05 # seconds; 20 ticks/s keeps editor latency imperceptible.
ROUND_TRIP_TIMEOUT <- NA # unused; kept here only to document that the new
# bridge has no synchronous timeout — pairing happens in the browser.

#' Resolve the top-level session from a (possibly module-namespaced) proxy.
#'
#' The browser sets the LSP channels under unprefixed names: the init input
#' `forge_editor_lsp_init`, and the per-editor `<elementId>_lsp_send` input,
#' where `elementId` is the editor's full DOM id (already carrying any module
#' namespace, e.g. `"editor-codeEditor"`). A module `session_proxy` re-prefixes
#' every `input[[...]]` read with its own namespace, so an observer registered on
#' the proxy would wait on `<ns>-forge_editor_lsp_init` and never see the frame.
#' Reading these inputs on the ROOT session matches the names verbatim. Inbound
#' `_lsp_recv` traffic goes out as a custom message (never namespaced), so it is
#' unaffected either way.
#' @noRd
forge_root_session <- function(session) {
  if (is.null(session)) {
    return(NULL)
  }
  # shiny >= 1.9 exposes rootScope(); a real ShinySession returns itself and a
  # proxy delegates up the chain to the top-level session.
  if (is.function(session$rootScope)) {
    return(session$rootScope())
  }
  # Fallback: climb the proxy chain manually.
  s <- session
  while (inherits(s, "session_proxy") && !is.null(.subset2(s, "parent"))) {
    s <- .subset2(s, "parent")
  }
  s
}

#' Ensure a session has the per-session LSP init observer installed.
#'
#' Called from `forge_editor()` whenever `lsp` is enabled. Idempotent: only
#' the first call installs the observer; later calls are no-ops. Without
#' this, the browser-side `Shiny.setInputValue("forge_editor_lsp_init", ...)`
#' would land in an unhandled input slot.
#' @noRd
ensure_lsp_init_observer <- function(session) {
  session <- forge_root_session(session)
  token <- session$token
  st <- .lsp_state[[token]]
  if (!is.null(st) && isTRUE(st$init_installed)) {
    return(invisible(NULL))
  }
  if (is.null(st)) {
    st <- list(
      init_installed = FALSE,
      bridges = new.env(parent = emptyenv())
    )
    .lsp_state[[token]] <- st
  }

  shiny::observeEvent(
    session$input[[LSP_INIT_INPUT]],
    {
      element_id <- session$input[[LSP_INIT_INPUT]]
      if (
        is.character(element_id) &&
          length(element_id) == 1 &&
          nzchar(element_id)
      ) {
        tryCatch(
          start_lsp_bridge(session, element_id),
          error = function(e) {
            warning(
              "forge.editor: failed to start LSP bridge for '",
              element_id,
              "': ",
              conditionMessage(e),
              call. = FALSE
            )
          }
        )
      }
    },
    ignoreInit = TRUE,
    domain = session
  )

  session$onSessionEnded(function() {
    bridges <- .lsp_state[[token]]$bridges
    if (!is.null(bridges)) {
      for (id in ls(bridges)) {
        b <- bridges[[id]]
        if (!is.null(b)) {
          b$state$alive <- FALSE
          if (!is.null(b$obs)) {
            try(b$obs$destroy(), silent = TRUE)
          }
          if (!is.null(b$state$proc) && b$state$proc$is_alive()) {
            try(b$state$proc$kill(), silent = TRUE)
          }
        }
      }
    }
    rm(list = token, envir = .lsp_state)
  })

  .lsp_state[[token]]$init_installed <- TRUE
  invisible(NULL)
}

#' Spin up the per-editor bridge.
#'
#' Idempotent on `(session, element_id)`. Spawns the `languageserver`
#' subprocess and installs the per-editor observer + pump.
#' @noRd
start_lsp_bridge <- function(session, element_id) {
  session <- forge_root_session(session)
  if (
    !is.character(element_id) || length(element_id) != 1 || !nzchar(element_id)
  ) {
    stop("element_id must be a non-empty character scalar", call. = FALSE)
  }
  token <- session$token
  st <- .lsp_state[[token]]
  if (is.null(st)) {
    stop(
      "forge.editor: init observer not installed for this session",
      call. = FALSE
    )
  }
  bridges <- st$bridges
  if (!is.null(bridges[[element_id]])) {
    return(invisible(element_id))
  }

  if (!requireNamespace("languageserver", quietly = TRUE)) {
    stop("the {languageserver} package is required for LSP support")
  }
  if (!requireNamespace("processx", quietly = TRUE)) {
    stop("the {processx} package is required for LSP support")
  }
  if (!requireNamespace("later", quietly = TRUE)) {
    stop("the {later} package is required for LSP support")
  }

  state <- new.env(parent = emptyenv())
  state$buf <- raw(0)
  state$alive <- TRUE

  rscript <- file.path(R.home("bin"), "Rscript")
  state$proc <- processx::process$new(
    rscript,
    c("--vanilla", "-e", "languageserver::run()"),
    stdin = "|",
    stdout = "|",
    stderr = "|"
  )

  send_input <- paste0(element_id, "_lsp_send")
  recv_channel <- paste0(element_id, "_lsp_recv")

  obs <- shiny::observeEvent(
    session$input[[send_input]],
    {
      msg <- session$input[[send_input]]
      if (!is.character(msg) || length(msg) != 1 || !nzchar(msg)) {
        return()
      }
      if (!state$alive || !state$proc$is_alive()) {
        return()
      }
      payload <- charToRaw(msg)
      header <- charToRaw(sprintf(
        "Content-Length: %d\r\n\r\n",
        length(payload)
      ))
      try(state$proc$write_input(c(header, payload)), silent = TRUE)
    },
    ignoreInit = TRUE,
    domain = session
  )

  pump <- function() {
    if (!state$alive) {
      return(invisible(NULL))
    }
    if (is.null(state$proc) || !state$proc$is_alive()) {
      state$alive <- FALSE
      return(invisible(NULL))
    }
    chunk <- tryCatch(state$proc$read_output(), error = function(e) "")
    if (nzchar(chunk)) {
      state$buf <- c(state$buf, charToRaw(chunk))
    }
    frames <- drain_frame_strings(state)
    for (frame_json in frames) {
      tryCatch(
        session$sendCustomMessage(recv_channel, frame_json),
        error = function(e) {
          # Session may be tearing down; stop the pump quietly.
          state$alive <<- FALSE
        }
      )
    }
    err <- tryCatch(state$proc$read_error(), error = function(e) "")
    if (nzchar(err)) {
      message("forge.editor languageserver stderr: ", trimws(err))
    }
    if (state$alive) {
      later::later(pump, delay = PUMP_INTERVAL)
    }
    invisible(NULL)
  }
  later::later(pump, delay = PUMP_INTERVAL)

  bridges[[element_id]] <- list(state = state, obs = obs)
  invisible(element_id)
}

# Parse out every complete LSP frame currently in `state$buf` and return the
# raw JSON body of each (as a UTF-8 character scalar), leaving any trailing
# partial frame behind for the next call. Returning the body verbatim avoids
# a lossy `fromJSON`/`toJSON` round-trip — numeric scalars stay scalar and
# explicit `null` fields are preserved.
drain_frame_strings <- function(state) {
  results <- character(0)
  buf <- state$buf
  repeat {
    hdr_end <- find_header_end(buf)
    if (is.na(hdr_end)) {
      break
    }
    header <- rawToChar(buf[seq_len(hdr_end - 4)])
    len <- parse_content_length(header)
    if (is.na(len)) {
      # Malformed header; drop it to resync.
      buf <- buf[-seq_len(hdr_end)]
      next
    }
    if (length(buf) < hdr_end + len) {
      break
    }
    body_raw <- buf[(hdr_end + 1):(hdr_end + len)]
    buf <- buf[-seq_len(hdr_end + len)]
    body <- rawToChar(body_raw)
    Encoding(body) <- "UTF-8"
    results <- c(results, body)
  }
  state$buf <- buf
  results
}

# Index of the last byte of the `\r\n\r\n` separator in `buf`, or NA if the
# separator hasn't fully arrived yet.
find_header_end <- function(buf) {
  if (length(buf) < 4) {
    return(NA_integer_)
  }
  for (i in 4:length(buf)) {
    if (
      buf[i - 3] == as.raw(0x0d) &&
        buf[i - 2] == as.raw(0x0a) &&
        buf[i - 1] == as.raw(0x0d) &&
        buf[i] == as.raw(0x0a)
    ) {
      return(i)
    }
  }
  NA_integer_
}

parse_content_length <- function(header) {
  m <- regmatches(
    header,
    regexpr("Content-Length:\\s*(\\d+)", header, ignore.case = TRUE)
  )
  if (length(m) == 0) {
    return(NA_integer_)
  }
  as.integer(sub("Content-Length:\\s*", "", m, ignore.case = TRUE))
}
