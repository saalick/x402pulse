import { Header } from "@/components/Header";
import { HealthScore } from "@/components/HealthScore";
import { LivePulse } from "@/components/LivePulse";
import { PaymentSizeDistribution } from "@/components/PaymentSizeDistribution";
import { StatsBar } from "@/components/StatsBar";
import { VolumeChart } from "@/components/VolumeChart";
import { Leaderboards } from "@/components/Leaderboards";
import { LiveFeed } from "@/components/LiveFeed";
import { NewAgentsFeed } from "@/components/NewAgentsFeed";
import { AlertBanner } from "@/components/AlertBanner";
import { DataWindowFooter } from "@/components/DataWindowFooter";
import { FacilitatorBreakdown } from "@/components/FacilitatorBreakdown";

export default function Page() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <Hero />
        <AlertBanner />
        <HealthScore />
        <StatsBar />
        <LivePulse />
        <FacilitatorBreakdown />
        <VolumeChart />
        <PaymentSizeDistribution />
        <Leaderboards />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <LiveFeed />
          <NewAgentsFeed />
        </div>
        <DataWindowFooter />
        <Footer />
      </main>
    </>
  );
}

function Hero() {
  return (
    <div className="animate-fade-in py-2">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        The pulse of the{" "}
        <span className="brand-gradient">agent economy</span>
      </h1>
      <p className="mt-2 max-w-xl text-sm text-white/50">
        Real-time analytics for the x402 payment protocol on Base. Every USDC
        payment from an AI agent to an x402 facilitator, indexed live.
      </p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="pt-8 text-center text-xs text-white/40">
      <a
        href="https://x.com/x402_pulse"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="x402pulse on X"
        className="inline-flex items-center gap-1.5 transition-colors hover:text-brand"
      >
        <XLogo />
        <span>@x402_pulse</span>
      </a>
    </footer>
  );
}

function XLogo() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 1200 1227"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026zM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026z"
      />
    </svg>
  );
}
