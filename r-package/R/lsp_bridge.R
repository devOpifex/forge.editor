# Per-session HTTP-to-stdio bridge for the R languageserver process.
#
# A Shiny session calls `start_lsp_bridge(session)` once on first use; that
# spawns an Rscript subprocess running `languageserver::run()`, registers a
# `session$registerDataObj` endpoint, and returns the relative URL the editor
# fetches against. The endpoint receives a JSON array of JSON-RPC messages,
# writes each one (framed with the LSP Content-Length header) to the
# subprocess's stdin, reads all complete frames currently available on stdout,
# and returns them as a JSON array.

# Per-session bridge state, keyed by `session$token`.
.bridges <- new.env(parent = emptyenv())

start_lsp_bridge <- function(session) {
  token <- session$token
  if (!is.null(.bridges[[token]])) {
    return(.bridges[[token]]$url)
  }

  if (!requireNamespace("languageserver", quietly = TRUE)) {
    stop("the {languageserver} package is required for LSP support")
  }
  if (!requireNamespace("processx", quietly = TRUE)) {
    stop("the {processx} package is required for LSP support")
  }
  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    stop("the {jsonlite} package is required for LSP support")
  }

  state <- new.env(parent = emptyenv())
  state$proc <- NULL
  state$stdout_buf <- raw(0)
  state$pending_ids <- character(0)
  state$lock <- FALSE

  ensure_proc <- function() {
    if (!is.null(state$proc) && state$proc$is_alive()) {
      return(invisible(NULL))
    }
    rscript <- file.path(R.home("bin"), "Rscript")
    state$proc <- processx::process$new(
      rscript,
      c("--vanilla", "-e", "languageserver::run()"),
      stdin = "|",
      stdout = "|",
      stderr = "|"
    )
    state$stdout_buf <- raw(0)
    invisible(NULL)
  }

  handler <- function(data, req) {
    body_raw <- req$rook.input$read(-1L)
    body <- if (length(body_raw) > 0) rawToChar(body_raw) else "[]"

    messages <- tryCatch(
      jsonlite::fromJSON(body, simplifyVector = FALSE),
      error = function(e) NULL
    )
    if (is.null(messages)) {
      return(shiny::httpResponse(
        400,
        "application/json",
        '{"error":"invalid JSON body"}'
      ))
    }
    if (!is.list(messages)) {
      messages <- list(messages)
    }

    out <- tryCatch(
      bridge_round_trip(state, ensure_proc, messages),
      error = function(e) {
        warning("forge.editor LSP bridge: ", conditionMessage(e), call. = FALSE)
        list()
      }
    )

    body_out <- jsonlite::toJSON(out, auto_unbox = TRUE, null = "null")
    shiny::httpResponse(200, "application/json", body_out)
  }

  url <- session$registerDataObj("forge_lsp", state, handler)

  session$onSessionEnded(function() {
    p <- .bridges[[token]]$state$proc
    if (!is.null(p) && p$is_alive()) {
      try(p$kill(), silent = TRUE)
    }
    rm(list = token, envir = .bridges)
  })

  .bridges[[token]] <- list(url = url, state = state)
  url
}

# Send `messages` to the subprocess and collect every complete frame that
# arrives on stdout, blocking only long enough for responses to any message
# that has an `id`.
bridge_round_trip <- function(state, ensure_proc, messages) {
  ensure_proc()

  # Coarse mutual exclusion. Shiny handlers run on a single R thread but the
  # browser may fire several POSTs back-to-back; the lock keeps the
  # request/response pairing intact.
  wait <- 0
  while (state$lock && wait < 2000) {
    Sys.sleep(0.005)
    wait <- wait + 5
  }
  state$lock <- TRUE
  on.exit(state$lock <- FALSE, add = TRUE)

  expected_ids <- character(0)
  for (msg in messages) {
    id <- msg[["id"]]
    if (!is.null(id)) {
      expected_ids <- c(expected_ids, as.character(id))
    }
    write_lsp_frame(state$proc, msg)
  }

  state$pending_ids <- unique(c(state$pending_ids, expected_ids))

  collected <- list()
  deadline <- Sys.time() + 5 # seconds

  repeat {
    chunk <- tryCatch(state$proc$read_output(), error = function(e) "")
    if (nzchar(chunk)) {
      state$stdout_buf <- c(state$stdout_buf, charToRaw(chunk))
    }
    frames <- drain_frames(state)
    if (length(frames)) {
      collected <- c(collected, frames)
    }

    # Stop as soon as every id we sent on this round-trip has a matching
    # response. Notifications keep flowing on subsequent polls.
    if (all_resolved(collected, expected_ids)) {
      break
    }
    if (Sys.time() > deadline) {
      break
    }
    Sys.sleep(0.01)
  }

  # Remove resolved ids from the pending set.
  resolved <- vapply(
    collected,
    function(m) {
      id <- m[["id"]]
      if (is.null(id)) "" else as.character(id)
    },
    character(1)
  )
  state$pending_ids <- setdiff(state$pending_ids, resolved)

  # Drain stderr without blocking so it doesn't fill up.
  err <- tryCatch(state$proc$read_error(), error = function(e) "")
  if (nzchar(err)) {
    message("forge.editor languageserver stderr: ", trimws(err))
  }

  collected
}

all_resolved <- function(collected, expected_ids) {
  if (length(expected_ids) == 0) {
    return(TRUE)
  }
  ids <- vapply(
    collected,
    function(m) {
      id <- m[["id"]]
      if (is.null(id)) "" else as.character(id)
    },
    character(1)
  )
  all(expected_ids %in% ids)
}

write_lsp_frame <- function(proc, msg) {
  json <- jsonlite::toJSON(msg, auto_unbox = TRUE, null = "null")
  payload <- charToRaw(json)
  header <- charToRaw(sprintf("Content-Length: %d\r\n\r\n", length(payload)))
  proc$write_input(c(header, payload))
}

# Parse out every complete LSP frame currently in `state$stdout_buf`, leaving
# any trailing partial frame behind for the next call.
drain_frames <- function(state) {
  results <- list()
  buf <- state$stdout_buf
  repeat {
    hdr_end <- find_header_end(buf)
    if (is.na(hdr_end)) {
      break
    }
    header <- rawToChar(buf[seq_len(hdr_end - 4)])
    len <- parse_content_length(header)
    if (is.na(len)) {
      # Malformed header; drop it to recover.
      buf <- buf[-seq_len(hdr_end)]
      next
    }
    if (length(buf) < hdr_end + len) {
      break
    }
    body <- rawToChar(buf[(hdr_end + 1):(hdr_end + len)])
    buf <- buf[-seq_len(hdr_end + len)]
    parsed <- tryCatch(
      jsonlite::fromJSON(body, simplifyVector = FALSE),
      error = function(e) NULL
    )
    if (!is.null(parsed)) results[[length(results) + 1]] <- parsed
  }
  state$stdout_buf <- buf
  results
}

# Find the index of the last byte of the `\r\n\r\n` separator in `buf`, or NA
# if the separator hasn't fully arrived yet.
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
