HTMLWidgets.widget({
  name: "forgeEditor",
  type: "output",

  factory: function(el, _width, _height) {
    var instance = null;
    var lastValue = null;

    return {
      renderValue: function(x) {
        console.log(x);
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
        if (x.lsp && x.lsp.url) opts.lsp = x.lsp;

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
