import type { Config } from "tailwindcss";

/**
 * Color tokens are driven by CSS custom properties so they swap with
 * theme. `--bg-rgb`, `--brand-rgb`, etc. are space-separated triplets
 * so Tailwind's `<alpha-value>` syntax (e.g. `text-brand/40`) works.
 *
 * Defaults live in `:root` (dark theme) and overrides live under
 * `html.light` — see globals.css.
 *
 * `white` is intentionally aliased to the theme's primary foreground
 * color so the codebase's existing `text-white`, `border-white/10`,
 * `bg-white/[0.03]` utilities all become theme-aware with no churn.
 * In dark mode that's near-white; in light mode it's near-black.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg-rgb) / <alpha-value>)",
        panel: "rgb(var(--panel-rgb) / <alpha-value>)",
        white: "rgb(var(--fg-rgb) / <alpha-value>)",
        brand: {
          DEFAULT: "rgb(var(--brand-rgb) / <alpha-value>)",
          dim: "rgb(var(--brand-rgb) / 0.6)",
          glow: "rgb(var(--brand-rgb) / 0.15)",
        },
        warn: {
          DEFAULT: "rgb(var(--warn-rgb) / <alpha-value>)",
          bg: "rgb(var(--warn-rgb) / 0.08)",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      animation: {
        "pulse-dot": "pulseDot 1.6s ease-in-out infinite",
        "pulse-ring": "pulseRing 1.6s cubic-bezier(0.4,0,0.6,1) infinite",
        "heartbeat-draw": "heartbeatDraw 2.4s ease-in-out infinite",
        "fade-in": "fadeIn 0.6s ease-out both",
        "fade-in-up": "fadeInUp 0.5s ease-out both",
        "row-in": "rowIn 0.55s cubic-bezier(0.22,1,0.36,1) both",
      },
      keyframes: {
        pulseDot: {
          "0%,100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.15)", opacity: "0.85" },
        },
        pulseRing: {
          "0%": { transform: "scale(0.9)", opacity: "0.8" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
        heartbeatDraw: {
          "0%":   { strokeDashoffset: "240" },
          "55%":  { strokeDashoffset: "0" },
          "100%": { strokeDashoffset: "-240" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        fadeInUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        rowIn: {
          from: { opacity: "0", transform: "translateY(-12px)", background: "rgb(var(--brand-rgb) / 0.10)" },
          to:   { opacity: "1", transform: "translateY(0)",     background: "transparent" },
        },
      },
      boxShadow: {
        "brand-glow": "0 0 24px rgb(var(--brand-rgb) / 0.25)",
        "brand-glow-sm": "0 0 12px rgb(var(--brand-rgb) / 0.18)",
        "card": "0 1px 0 rgb(var(--card-inset-rgb) / 0.04) inset, 0 8px 24px rgb(var(--card-shadow-rgb) / var(--card-shadow-alpha))",
      },
    },
  },
  plugins: [],
};
export default config;
