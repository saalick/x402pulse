"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";
const STORAGE_KEY = "x402pulse:theme";

/**
 * Sun/moon toggle. Persists choice in localStorage and applies
 * the `light` class to <html>. The inline script in layout.tsx
 * sets the class before paint so there's no flash on load.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  // On mount, read whatever the inline script put on <html>.
  useEffect(() => {
    const current = document.documentElement.classList.contains("light") ? "light" : "dark";
    setTheme(current);
    setMounted(true);
  }, []);

  const flip = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "light") document.documentElement.classList.add("light");
    else document.documentElement.classList.remove("light");
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  };

  // Render a placeholder until mounted to avoid hydration mismatch.
  if (!mounted) {
    return <div className="h-9 w-9 rounded-md border border-white/10 bg-white/[0.03]" aria-hidden />;
  }

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      className="grid h-9 w-9 place-items-center rounded-md border border-white/10 bg-white/[0.03] text-white/70 transition hover:border-brand/40 hover:text-brand"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
    </svg>
  );
}
