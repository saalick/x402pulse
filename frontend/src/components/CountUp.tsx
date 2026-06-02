"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  /** ms — animation duration */
  duration?: number;
  decimals?: number;
  /** "$" prefix or anything else */
  prefix?: string;
  suffix?: string;
  /** Use compact (e.g. "1.2K") instead of full digits. */
  compact?: boolean;
};

/**
 * Animated numeric count-up. Animates from previous displayed value to
 * the new target whenever `value` changes — so stat refreshes feel alive
 * rather than just snapping.
 */
export function CountUp({
  value,
  duration = 900,
  decimals = 0,
  prefix = "",
  suffix = "",
  compact = false,
}: Props) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = display;
    startRef.current = null;
    let raf = 0;

    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = fromRef.current + (value - fromRef.current) * eased;
      setDisplay(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  const fmt = compact
    ? new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: decimals,
      })
    : new Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });

  return (
    <span className="tabular">
      {prefix}
      {fmt.format(display)}
      {suffix}
    </span>
  );
}
