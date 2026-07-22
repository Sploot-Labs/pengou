/**
 * Sploot Labs — Tailwind theme extension
 * Usage (tailwind.config.js):
 *   const sploot = require("./brand-kit/tailwind.tokens.js");
 *   module.exports = { darkMode: ["class", '[data-theme="dark"]'], theme: { extend: sploot } };
 *
 * Les couleurs pointent vers les CSS vars de design-tokens.css → light/dark automatiques.
 * Importe design-tokens.css dans ton entrée CSS pour que les vars existent.
 */
module.exports = {
  colors: {
    ginger:      "var(--sploot-ginger)",
    "ginger-deep": "var(--sploot-ginger-deep)",
    petrol:      "var(--sploot-petrol)",
    "petrol-soft": "var(--sploot-petrol-soft)",
    cream:       "var(--sploot-cream)",
    "sploot-bg":      "var(--sploot-bg)",
    "sploot-surface": "var(--sploot-surface)",
    "sploot-surface-2": "var(--sploot-surface-2)",
    "sploot-text":    "var(--sploot-text)",
    "sploot-muted":   "var(--sploot-muted)",
    "sploot-line":    "var(--sploot-line)",
    ok:   "var(--sploot-ok)",
    warn: "var(--sploot-warn)",
    bad:  "var(--sploot-bad)",
  },
  fontFamily: {
    display: ["Bricolage Grotesque", "Bahnschrift", "ui-sans-serif", "system-ui", "sans-serif"],
    body:    ["Hanken Grotesk", "ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
    mono:    ["JetBrains Mono", "ui-monospace", "Cascadia Code", "SF Mono", "Consolas", "monospace"],
  },
  borderRadius: {
    card: "14px",
    pill: "999px",
  },
  maxWidth: {
    content: "1080px",
  },
};
