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
      var opts = Array.isArray(spec.options) ? spec.options.slice() : [];
      return {
        pattern: re,
        options: function() { return opts; }
      };
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
          // Re-apply decorations on re-render so a Shiny `renderForgeEditor`
          // that swaps the spec list takes effect without a full remount.
          instance.setDecorations(toNativeDecorations(x.decorations));
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
        }
      },

      resize: function(_w, _h) {},

      getInstance: function() {
        return instance;
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
