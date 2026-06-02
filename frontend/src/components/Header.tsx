import Image from "next/image";
import Link from "next/link";
import { SearchBar } from "./SearchBar";

/**
 * Top navigation: logo, search bar, LIVE indicator, nav links.
 * Sticky with backdrop blur — sits over the main content as it scrolls.
 *
 * The search bar tucks below the logo on small screens (the right-hand
 * cluster wraps independently to keep things readable).
 */
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-bg/70 backdrop-blur-md">
      <div className="mx-auto flex flex-wrap items-center gap-3 px-6 py-2 sm:flex-nowrap sm:gap-5 sm:py-0 sm:h-16 max-w-7xl">
        <Link
          href="/"
          aria-label="x402pulse home"
          className="group flex shrink-0 items-center"
        >
          {/* Source PNG is 916×246. Constrain by height so it sits cleanly
              in the 64px header without aliasing on hi-DPI displays. */}
          <Image
            src="/logo.png"
            alt="x402Pulse"
            width={156}
            height={42}
            priority
            className="h-9 w-auto sm:h-10"
          />
        </Link>

        <div className="order-3 w-full sm:order-none sm:flex-1 sm:max-w-[320px]">
          <SearchBar />
        </div>

        <div className="ml-auto flex items-center gap-5">
          <LiveBadge />
          <Link
            href="/score"
            className="text-sm text-white/60 transition-colors hover:text-brand"
          >
            Score
          </Link>
          <Link
            href="/map"
            className="text-sm text-white/60 transition-colors hover:text-brand"
          >
            Map
          </Link>
          <Link
            href="/report"
            className="text-sm text-white/60 transition-colors hover:text-brand"
          >
            Report
          </Link>
          <Link
            href="/watch"
            className="text-sm text-white/60 transition-colors hover:text-brand"
          >
            Watchlist
          </Link>
          <Link
            href="/calculator"
            className="text-sm text-white/60 transition-colors hover:text-brand"
          >
            Calculator
          </Link>
          <Link
            href="/api-docs"
            className="text-sm text-white/60 transition-colors hover:text-brand"
          >
            API
          </Link>
          <a
            href="https://github.com/Merit-Systems/x402scan"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-white/60 transition-colors hover:text-brand"
          >
            GitHub ↗
          </a>
        </div>
      </div>
    </header>
  );
}

function LiveBadge() {
  return (
    <div className="flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1.5">
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
