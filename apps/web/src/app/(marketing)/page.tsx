import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function MarketingPage() {
  return (
    <div className="min-h-screen bg-[#090a0f] text-slate-100 selection:bg-blue-600 selection:text-white">
      {/* Navigation Header */}
      <header className="border-b border-slate-800/80 bg-[#0c0e15]/70 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/30">
              G
            </div>
            <span className="font-bold text-lg tracking-tight text-white">Growth Intelligence</span>
            <Badge variant="success">v1.0 Ready</Badge>
          </div>

          <div className="flex items-center space-x-4">
            <Link href="/login" className="text-sm font-medium text-slate-300 hover:text-white transition">
              Sign In
            </Link>
            <Link href="/signup">
              <Button size="sm">Get Started Free</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-6 pt-20 pb-28">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <Badge variant="outline" className="mb-4">Privacy-First SaaS Growth Analytics</Badge>
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight text-white leading-tight mb-6">
            Understand which traffic creates <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-teal-400">paying customers</span>.
          </h1>
          <p className="text-lg text-slate-400 mb-8 leading-relaxed">
            Install one tiny &lt;2KB script in 2 minutes. Cookie-free, lightweight, and engineered to connect your top acquisition channels straight to subscription revenue.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/signup" className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto text-base">
                Start Free 14-Day Trial
              </Button>
            </Link>
            <Link href="/share/demo" className="w-full sm:w-auto">
              <Button variant="outline" size="lg" className="w-full sm:w-auto text-base">
                View Live Interactive Demo
              </Button>
            </Link>
          </div>
        </div>

        {/* Live Metrics Showcase Preview Card */}
        <div className="rounded-2xl border border-slate-800 bg-[#0f121d] p-6 shadow-2xl relative overflow-hidden mb-24">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-slate-800/80 pb-4 mb-6 gap-4">
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl font-bold text-white">Live Workspace Analytics Preview</h2>
                <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs text-emerald-400 font-medium">Realtime Active</span>
              </div>
              <p className="text-sm text-slate-400">demo.growthintelligence.io • Last 30 Days (UTC)</p>
            </div>
            <div className="flex items-center space-x-2">
              <Badge variant="outline">EU-Central-1</Badge>
              <Badge variant="success">100% Cookieless</Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="p-4 rounded-xl bg-[#141824] border border-slate-800">
              <div className="text-xs text-slate-400 font-medium">Monthly Visitors</div>
              <div className="text-2xl font-bold text-white mt-1">42,850</div>
              <div className="text-xs text-emerald-400 mt-1 font-semibold">+18.4% vs last month</div>
            </div>
            <div className="p-4 rounded-xl bg-[#141824] border border-slate-800">
              <div className="text-xs text-slate-400 font-medium">Total Pageviews</div>
              <div className="text-2xl font-bold text-white mt-1">128,490</div>
              <div className="text-xs text-emerald-400 mt-1 font-semibold">+24.1% vs last month</div>
            </div>
            <div className="p-4 rounded-xl bg-[#141824] border border-slate-800">
              <div className="text-xs text-slate-400 font-medium">Avg Duration</div>
              <div className="text-2xl font-bold text-white mt-1">3m 42s</div>
              <div className="text-xs text-slate-400 mt-1 font-semibold">Healthy engagement</div>
            </div>
            <div className="p-4 rounded-xl bg-[#141824] border border-slate-800">
              <div className="text-xs text-slate-400 font-medium">Bounce Rate</div>
              <div className="text-2xl font-bold text-white mt-1">31.2%</div>
              <div className="text-xs text-emerald-400 mt-1 font-semibold">-4.3% vs baseline</div>
            </div>
          </div>

          {/* Breakdown Tables Mock */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl bg-[#141824] border border-slate-800 p-4">
              <h3 className="text-sm font-semibold text-slate-200 mb-3">Top Pages</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                  <span className="text-slate-300 font-mono text-xs">/</span>
                  <span className="text-slate-200 font-semibold">18,240 (42.5%)</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                  <span className="text-slate-300 font-mono text-xs">/pricing</span>
                  <span className="text-slate-200 font-semibold">8,190 (19.1%)</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-300 font-mono text-xs">/docs/quickstart</span>
                  <span className="text-slate-200 font-semibold">4,620 (10.7%)</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-[#141824] border border-slate-800 p-4">
              <h3 className="text-sm font-semibold text-slate-200 mb-3">Top Acquisition Channels</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                  <span className="text-slate-300">Google Organic</span>
                  <span className="text-slate-200 font-semibold">14,320 (33.4%)</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                  <span className="text-slate-300">GitHub (Referral)</span>
                  <span className="text-slate-200 font-semibold">9,810 (22.8%)</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-300">X / Twitter</span>
                  <span className="text-slate-200 font-semibold">5,430 (12.6%)</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-24">
          <Card>
            <CardHeader>
              <CardTitle>Privacy by Default</CardTitle>
              <CardDescription>
                No cookies required. IP addresses are processed transiently for geo checks and instantly truncated or discarded.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Lightning Fast &lt; 2KB SDK</CardTitle>
              <CardDescription>
                Modern sendBeacon transport with keepalive fetch fallback. Built for zero impact on Core Web Vitals and Lighthouse scores.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>ClickHouse + PostgreSQL Core</CardTitle>
              <CardDescription>
                High-throughput columnar event storage deduplicated by UUID, paired with PostgreSQL multi-tenant isolation.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </main>
    </div>
  );
}

