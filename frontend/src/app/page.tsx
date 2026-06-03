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
    <footer className="pt-8 text-center text-xs text-white/30">
      <p>
        Built with x402scan facilitator data ·{" "}
        <a
          href="https://github.com/Merit-Systems/x402scan"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-brand"
        >
          source
        </a>
      </p>
    </footer>
  );
}
