HTMLWidgets.widget({
  name: "forgeEditor",
  type: "output",

  factory: function(el, _width, _height) {
    var instance = null;
    var lastValue = null;

    // Convert an R-side decoration spec (string `pattern`, string `flags`,
    // array of `{value, label}`) into the JS-native shape consumed by
    // `ForgeEditor.mount({ decorations })` / `instance.setDecorations()`.
    function toNativeDecoration(spec) {
      if (!spec || typeof spec.pattern !== "string") return null;
      var flags = typeof spec.flags === "string" ? spec.flags : "";
      var re;
      try {
        re = new RegExp(spec.pattern, flags);
      } catch (err) {
        console.warn("[forge.editor] invalid decoration pattern:", spec.pattern, err);
        return null;
      }
      // `options` may be a function (dynamic/async, e.g. fetch()) supplied from
      // downstream JS via setDecorations; forward it untouched. The R
      // `forge_decoration()` path always sends a static array, which we wrap.
      var options;
      if (typeof spec.options === "function") {
        options = spec.options;
      } else {
        var opts = Array.isArray(spec.options) ? spec.options.slice() : [];
        options = function() { return opts; };
      }
      return { pattern: re, options: options };
    }

    function toNativeDecorations(specs) {
      if (!specs) return [];
      // htmlwidgets may pass a single spec unwrapped if R sent length-1 list.
      var arr = Array.isArray(specs) ? specs : [specs];
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var d = toNativeDecoration(arr[i]);
        if (d) out.push(d);
      }
      return out;
    }

    return {
      renderValue: function(x) {
        if (!window.ForgeEditor || typeof window.ForgeEditor.mount !== "function") {
          el.textContent = "forge.editor: JS bundle not loaded.";
          return;
        }

        if (instance) {
          if (typeof x.value === "string" && x.value !== lastValue) {
            instance.setValue(x.value);
            lastValue = x.value;
          }
          // Re-apply decorations and theme on re-render so a Shiny
          // `renderForgeEditor` that swaps either takes effect without a
          // full remount.
          instance.setDecorations(toNativeDecorations(x.decorations));
          if (typeof x.theme === "string") instance.setTheme(x.theme);
          return;
        }

        var opts = {
          value: x.value || "",
          theme: x.theme || "light",
          readOnly: !!x.readOnly
        };
        if (x.catalog) opts.catalog = x.catalog;

        var nativeDecos = toNativeDecorations(x.decorations);
        if (nativeDecos.length) opts.decorations = nativeDecos;

        // The R side ships `x.lsp` as `{ enabled: true, ... }` whenever the
        // Shiny session has installed the init observer. The JS-side
        // `ShinyTransport` defaults `elementId` to `el.id`, so multiple
        // editors in one app each get their own per-id send/recv channels.
        if (x.lsp && x.lsp.enabled) {
          var lspOpts = {};
          if (x.lsp.rootUri) lspOpts.rootUri = x.lsp.rootUri;
          if (x.lsp.documentUri) lspOpts.documentUri = x.lsp.documentUri;
          if (x.lsp.languageId) lspOpts.languageId = x.lsp.languageId;
          if (x.lsp.elementId) lspOpts.elementId = x.lsp.elementId;
          opts.lsp = lspOpts;
        }

        instance = window.ForgeEditor.mount(el, opts);
        lastValue = opts.value;

        if (window.HTMLWidgets && HTMLWidgets.shinyMode &&
            typeof Shiny !== "undefined" && el.id) {
          instance.onChange(function(code) {
            Shiny.setInputValue(el.id + "_code", code, { priority: "deferred" });
          });
          // Report a resolved merge (opened via `updateForgeEditor(merge=TRUE)`).
          // `e = { code, accepted, rejected }`. If the R side supplied a custom
          // `onMerge` callback (an htmlwidgets::JS() function), defer to it so the
          // author controls the input name/payload; otherwise use the default
          // `<id>_merge` input. `priority:"event"` so identical resolves still fire.
          instance.onMergeResolve(function(e) {
            if (typeof x.onMerge === "function") {
              x.onMerge(e, el.id);
            } else {
              Shiny.setInputValue(el.id + "_merge", e, { priority: "event" });
            }
          });
        }
      },

      resize: function(_w, _h) {},

      getInstance: function() {
        return instance;
      },

      // Apply a dynamic update pushed from R via `updateForgeEditor()` /
      // `Shiny.addCustomMessageHandler("forgeEditor:update", ...)`. Only the
      // document `code` is honoured for now; `lastValue` is kept in sync so a
      // later `renderValue` re-render does not clobber the pushed value. The
      // message shape is intentionally open for future fields (theme, etc.).
      update: function(msg) {
        if (!instance || !msg) return;
        if (typeof msg.code === "string") {
          // `merge:true` opens a unified diff/merge view instead of replacing
          // the document outright. `lastValue` is kept in sync either way so a
          // later `renderValue` re-render does not clobber the pushed value.
          instance.setValue(msg.code, { merge: !!msg.merge });
          lastValue = msg.code;
        }
        // Bulk-resolve a merge already on screen.
        if (msg.action === "acceptAll") instance.acceptAllChanges();
        if (msg.action === "rejectAll") instance.rejectAllChanges();
        // Toggle read-only at runtime. Absent when R sent `read_only = NULL`.
        if (typeof msg.readOnly === "boolean") instance.setReadOnly(msg.readOnly);
        // Swap the colour theme at runtime.
        if (typeof msg.theme === "string") instance.setTheme(msg.theme);
      },

      // Public helper for downstream JS to swap decoration specs at runtime
      // using the same shape as the R `forge_decoration()` output. Accepts
      // either an array of R-style specs or a single one.
      setDecorations: function(specs) {
        if (!instance) return;
        instance.setDecorations(toNativeDecorations(specs));
      }
    };
  }
});

// Bridge for the R `updateForgeEditor()` proxy. Registered once globally; it
// resolves the target widget by DOM id and delegates to the binding's
// `update` method, reusing the live editor instance (no remount).
if (typeof Shiny !== "undefined" && Shiny.addCustomMessageHandler &&
    !window.__forgeEditorUpdateBound) {
  window.__forgeEditorUpdateBound = true;
  Shiny.addCustomMessageHandler("forgeEditor:update", function(msg) {
    if (!msg || !msg.id) return;
    var el = document.getElementById(msg.id);
    if (!el) return;
    var widget = HTMLWidgets.getInstance(el);
    if (widget && typeof widget.update === "function") widget.update(msg);
  });
}
