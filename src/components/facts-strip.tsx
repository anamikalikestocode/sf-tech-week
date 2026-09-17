import type { Fact } from "@/lib/insights";

// Horizontal strip of "facts nobody else has" — computed server-side from the
// snapshot. Pure markup, scrolls sideways on mobile.
export function FactsStrip({ facts }: { facts: Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <section aria-label="Facts from the data" className="border-b border-[#DDD3BD] bg-[#F7F2E7]">
      <div className="mx-auto max-w-[1200px] px-[22px] py-4">
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#766E5C]">Things the official site won&apos;t tell you</h2>
          <span className="text-[11px] text-[#A79E89]">scraped from every Partiful page</span>
        </div>
        <div className="-mx-[22px] flex gap-3 overflow-x-auto px-[22px] pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {facts.map((f, i) => {
            const inner = (
              <>
                <div className="text-[22px] font-extrabold leading-none tracking-[-0.03em] text-[#1C1A14]">{f.stat}</div>
                <div className="mt-1.5 text-[12.5px] leading-[1.35] text-[#766E5C]">{f.text}</div>
              </>
            );
            const cls =
              "flex w-[240px] shrink-0 flex-col justify-between rounded-[12px] border border-[#DDD3BD] bg-[#E9E2D3] px-4 py-3";
            return f.event?.url ? (
              <a key={i} href={f.event.url} target="_blank" rel="noopener noreferrer" className={cls + " transition-colors hover:border-[#00FF9C]"}>
                {inner}
              </a>
            ) : (
              <div key={i} className={cls}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
