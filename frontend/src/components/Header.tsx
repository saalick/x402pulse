"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SearchBar } from "./SearchBar";
import { ThemeToggle } from "./ThemeToggle";

// Single source of truth for nav links — used by both desktop bar and
// mobile dropdown so nothing drifts out of sync.
type NavLink = { href: string; label: string; external?: boolean };
const NAV: NavLink[] = [
  { href: "/score",       label: "Score" },
  { href: "/map",         label: "Map" },
  { href: "/report",      label: "Report" },
  { href: "/watch",       label: "Watchlist" },
  { href: "/api-docs",    label: "API" },
  { href: "https://github.com/saalick/x402pulse", label: "GitHub ↗", external: true },
];

/**
 * Top navigation: logo, LIVE indicator, nav links.
 *
 * Layout:
 *   - lg+        full row: logo · live badge · nav links
 *   - below lg   compact: logo · live badge · hamburger
 *                hamburger opens a dropdown with all nav links
 *
 * The site-wide search bar lives in its own strip below the header
 * (see SearchBarStrip / layout.tsx) so it gets the full width treatment.
 */
export function Header() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the menu whenever the route changes (Link click navigates).
  useEffect(() => { setOpen(false); }, [pathname]);

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <div className="sticky top-0 z-40">
    <header className="border-b border-white/5 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:gap-5 sm:px-6 lg:h-16">
        <Link
          href="/"
          aria-label="x402pulse home"
          className="group flex shrink-0 items-center"
        >
          {/* Both logos ship; globals.css hides the wrong one based on
              the html.light class so the swap is instant on toggle. */}
          <Image
            src="/logo.png"
            alt="x402Pulse"
            width={156}
            height={42}
            priority
            className="theme-dark-only h-8 w-auto sm:h-9 lg:h-10"
          />
          <Image
            src="/logo-light.png"
            alt="x402Pulse"
            width={156}
            height={42}
            priority
            className="theme-light-only h-8 w-auto sm:h-9 lg:h-10"
          />
        </Link>

        <div className="ml-auto flex items-center gap-3 sm:gap-5">
          <LiveBadge />

          {/* Desktop nav */}
          <nav className="hidden items-center gap-5 lg:flex">
            {NAV.map((n) => <NavItem key={n.href} link={n} active={pathname === n.href} />)}
          </nav>

          <ThemeToggle />

          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="grid h-9 w-9 place-items-center rounded-md border border-white/10 bg-white/[0.03] text-white/80 transition hover:border-brand/40 hover:text-brand lg:hidden"
          >
            <Hamburger open={open} />
          </button>
        </div>
      </div>

      {/* Mobile dropdown panel */}
      {open && (
        <div className="border-t border-white/5 bg-bg/95 backdrop-blur-md lg:hidden">
          <nav className="mx-auto grid max-w-7xl grid-cols-2 gap-2 px-4 py-4 sm:px-6">
            {NAV.map((n) => (
              <NavItem
                key={n.href}
                link={n}
                active={pathname === n.href}
                variant="block"
              />
            ))}
          </nav>
        </div>
      )}
    </header>

    {/* Site-wide search strip — sticky with the header above it. */}
    <div className="border-b border-white/5 bg-bg/70 backdrop-blur-md">
      <div className="mx-auto max-w-3xl px-4 py-3 sm:px-6 sm:py-4">
        <SearchBar />
      </div>
    </div>
    </div>
  );
}

function NavItem({
  link,
  active,
  variant = "inline",
}: {
  link: NavLink;
  active: boolean;
  variant?: "inline" | "block";
}) {
  // Two stylings: small inline text for the desktop bar, and a chunky
  // block/button feel for the mobile dropdown (bigger tap targets).
  const base = variant === "inline"
    ? "text-sm transition-colors"
    : "rounded-md border px-3 py-2 text-sm transition";

  const color = active
    ? (variant === "inline"
        ? "text-brand"
        : "border-brand/40 bg-brand/10 text-brand")
    : (variant === "inline"
        ? "text-white/60 hover:text-brand"
        : "border-white/10 bg-white/[0.03] text-white/80 hover:border-brand/30 hover:text-brand");

  const className = `${base} ${color}`;

  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
        {link.label}
      </a>
    );
  }
  return (
    <Link href={link.href} className={className}>
      {link.label}
    </Link>
  );
}

function Hamburger({ open }: { open: boolean }) {
  return (
    <svg
      width="18" height="18" viewBox="0 0 18 18" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden
    >
      {open ? (
        <>
          <line x1="3" y1="3" x2="15" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="15" y1="3" x2="3" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : (
        <>
          <line x1="2" y1="5"  x2="16" y2="5"  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="2" y1="9"  x2="16" y2="9"  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="2" y1="13" x2="16" y2="13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function LiveBadge() {
  return (
    <div className="hidden items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1.5 sm:flex">
      <span className="relative inline-flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-brand" />
        <span className="relative inline-flex h-2 w-2 animate-pulse-dot rounded-full bg-brand" />
      </span>
      <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand">
        Live
      </span>
    </div>
  );
}
