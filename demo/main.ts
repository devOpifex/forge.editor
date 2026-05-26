import { mount } from "../src/index";

const el = document.getElementById("editor");
if (!el) throw new Error("#editor not found");

const ed = mount(el, {
  theme: "dark",
  value: [
    "library(dplyr)",
    "",
    "mtcars |>",
    "  filter(mpg > 20) |>",
    "  ",
  ].join("\n"),
  onChange: (code) => console.log(`change: ${code.length} chars`),
});

// Expose for manual poking from the browser console.
(window as unknown as { ed: typeof ed }).ed = ed;
