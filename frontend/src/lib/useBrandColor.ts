"use client";

import { useEffect, useState } from "react";

/**
 * Reads the live `--brand-hex` value from the document root so that
 * Recharts (and any other API that needs a literal hex string) picks
 * up the current theme. Re-reads when the html.light class flips.
 *
 * Returns the dark-theme default during SSR so charts render correctly
 * before the theme bootstrap runs.
 */
export function useBrandColor(): string {
  const [color, setColor] = useState("#00ff88");

  useEffect(() => {
    const read = () => {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue("--brand-hex")
        .trim();
      if (v) setColor(v);
    };
    read();

    // Observe theme flips — ThemeToggle adds/removes the `light` class.
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return color;
}

/**
 * Returns the current theme ("dark" | "light") and re-renders when it flips.
 * Useful for picking between two pre-built color palettes.
 */
export function useThemeMode(): "dark" | "light" {
  const [mode, setMode] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const read = () =>
      setMode(document.documentElement.classList.contains("light") ? "light" : "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return mode;
}

/** Same idea but for the muted foreground (text-white/40 etc.). */
export function useFgColor(alpha = 1): string {
  const [color, setColor] = useState(`rgba(245,245,245,${alpha})`);

  useEffect(() => {
    const read = () => {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue("--fg-rgb")
        .trim();
      if (v) setColor(`rgb(${v.replace(/\s+/g, ",")} / ${alpha})`);
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, [alpha]);

  return color;
}
