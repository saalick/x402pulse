import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0a",
        panel: "rgba(255,255,255,0.02)",
        border: "rgba(255,255,255,0.06)",
        brand: {
          DEFAULT: "#00ff88",
          dim: "rgba(0,255,136,0.6)",
          glow: "rgba(0,255,136,0.15)",
        },
        warn: {
          DEFAULT: "#ffcc33",
          bg: "rgba(255,204,51,0.08)",
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
          from: { opacity: "0", transform: "translateY(-12px)", background: "rgba(0,255,136,0.10)" },
          to:   { opacity: "1", transform: "translateY(0)",     background: "transparent" },
        },
      },
      boxShadow: {
        "brand-glow": "0 0 24px rgba(0,255,136,0.25)",
        "card": "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.4)",
      },
    },
  },
  plugins: [],
};
export default config;
