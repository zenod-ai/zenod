// Apply the stored theme (default: system) before first paint, same key as ThemeProvider.
// A file, not an inline script, so the page keeps script-src 'self' (ZAL-A13).
try {
  var t = localStorage.getItem("theme");
  var dark = t === "dark" || ((t !== "light") && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.add(dark ? "dark" : "light");
} catch (e) {}
