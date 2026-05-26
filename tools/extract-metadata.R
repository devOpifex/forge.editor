#!/usr/bin/env Rscript
# Extract autocomplete/hover metadata for forge.editor.
#
# Usage:
#   Rscript tools/extract-metadata.R pkgA pkgB [...]      # installed packages
#   Rscript tools/extract-metadata.R ../composer          # source package dir
#   Rscript tools/extract-metadata.R --out path.json ...  # custom output
#
# Each argument is either a directory containing a DESCRIPTION (source mode,
# loaded with pkgload so the catalog reflects the on-disk NAMESPACE) or an
# installed package name. Emits a JSON object keyed by package name matching
# the `Catalog` type in src/types.ts; each entry has: name, type, signature?,
# doc?. If the output file already exists, the generated package keys are merged
# in (other packages are preserved).

args <- commandArgs(trailingOnly = TRUE)

out <- "data/catalog.json"
if ("--out" %in% args) {
  i <- which(args == "--out")[1]
  out <- args[i + 1]
  args <- args[-c(i, i + 1)]
}
targets <- args
if (length(targets) == 0) {
  stop("Provide at least one package name or source directory.")
}

if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("Package 'jsonlite' is required: install.packages('jsonlite')")
}

# A human-readable signature, e.g. `table(..., total_col = c("none", "nested"))`.
# Uses deparse(args(fn)) so missing (no-default) args are not forced and the
# original defaults / balanced parens are preserved.
signature_of <- function(fn, name) {
  a <- args(fn)
  if (is.null(a)) {
    return(paste0(name, "()"))
  }
  d <- deparse(a)
  d <- d[-length(d)] # drop the trailing "NULL" body line
  h <- gsub("\\s+", " ", paste(d, collapse = " "))
  paste0(name, trimws(sub("^function\\s*", "", h)))
}

# Map every documented alias to its help-page title, from either an installed
# package (`pkg`) or a source package directory (`dir`).
doc_titles <- function(pkg, dir = NULL) {
  db <- tryCatch(
    if (is.null(dir)) tools::Rd_db(pkg) else tools::Rd_db(dir = dir),
    error = function(e) NULL
  )
  titles <- list()
  if (is.null(db)) {
    return(titles)
  }
  for (rd in db) {
    tags <- vapply(rd, function(x) attr(x, "Rd_tag"), character(1))
    ti <- which(tags == "\\title")
    title <- if (length(ti)) {
      trimws(paste(unlist(rd[[ti[1]]]), collapse = ""))
    } else {
      ""
    }
    for (a in which(tags == "\\alias")) {
      alias <- trimws(paste(unlist(rd[[a]]), collapse = ""))
      titles[[alias]] <- title
    }
  }
  titles
}

# Resolve a target argument to a loaded package name + its source dir (if any).
resolve_target <- function(target) {
  if (dir.exists(target) && file.exists(file.path(target, "DESCRIPTION"))) {
    if (!requireNamespace("pkgload", quietly = TRUE)) {
      stop("Source mode needs 'pkgload': install.packages('pkgload')")
    }
    dir <- normalizePath(target)
    pkg <- unname(read.dcf(file.path(dir, "DESCRIPTION"), fields = "Package")[
      1,
      1
    ])
    ok <- tryCatch(
      {
        suppressWarnings(suppressMessages(
          pkgload::load_all(
            dir,
            export_all = FALSE,
            quiet = TRUE,
            helpers = FALSE
          )
        ))
        TRUE
      },
      error = function(e) {
        warning(sprintf(
          "Could not load source '%s': %s",
          target,
          conditionMessage(e)
        ))
        FALSE
      }
    )
    if (!ok) {
      return(NULL)
    }
    list(pkg = pkg, dir = dir)
  } else {
    if (!requireNamespace(target, quietly = TRUE)) {
      warning(sprintf("Package '%s' is not installed; skipping.", target))
      return(NULL)
    }
    list(pkg = target, dir = NULL)
  }
}

# Build the catalog entries for one resolved package.
extract_pkg <- function(pkg, dir = NULL) {
  ns <- asNamespace(pkg)
  exports <- sort(getNamespaceExports(pkg))
  titles <- doc_titles(pkg, dir)

  items <- list()
  for (name in exports) {
    obj <- tryCatch(get(name, envir = ns), error = function(e) NULL)
    if (is.null(obj)) {
      next
    }
    is_fn <- is.function(obj)
    item <- list(name = name, type = if (is_fn) "function" else "object")
    if (is_fn) {
      sig <- tryCatch(signature_of(obj, name), error = function(e) NULL)
      if (!is.null(sig)) item$signature <- sig
    }
    title <- titles[[name]]
    if (!is.null(title) && nzchar(title)) {
      item$doc <- title
    }
    items[[length(items) + 1]] <- item
  }
  items
}

generated <- list()
for (target in targets) {
  resolved <- resolve_target(target)
  if (is.null(resolved)) {
    next
  }
  items <- extract_pkg(resolved$pkg, resolved$dir)
  generated[[resolved$pkg]] <- items
  cat(sprintf("  %s: %d functions\n", resolved$pkg, length(items)))
}

# Merge into any existing catalog so other packages' entries are preserved.
catalog <- list()
if (file.exists(out)) {
  catalog <- jsonlite::read_json(out, simplifyVector = FALSE)
}
for (pkg in names(generated)) {
  catalog[[pkg]] <- generated[[pkg]]
}

dir.create(dirname(out), showWarnings = FALSE, recursive = TRUE)
jsonlite::write_json(catalog, out, auto_unbox = TRUE, pretty = TRUE)
cat(sprintf("Wrote %s (%d packages)\n", out, length(catalog)))
