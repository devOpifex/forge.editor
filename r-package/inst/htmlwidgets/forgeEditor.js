HTMLWidgets.widget({
  name: "forgeEditor",
  type: "output",

  factory: function(el, _width, _height) {
    var instance = null;
    var lastValue = null;

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
          return;
        }

        var opts = {
          value: x.value || "",
          theme: x.theme || "light",
          readOnly: !!x.readOnly
        };
        if (x.catalog) opts.catalog = x.catalog;

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
      }
    };
  }
});
