import type { Leaderboard } from "@/lib/insights";

// Server-rendered leaderboards in a collapsible block. No JS: <details> does
// the toggling, so it works before hydration (in-app browsers from tweets).
export function Leaderboards({ boards }: { boards: Leaderboard[] }) {
  if (boards.length === 0) return null;
  return (
    <section className="border-b border-[#DDD3BD] bg-[#E9E2D3]">
      <div className="mx-auto max-w-[1200px] px-[22px]">
        <details className="group py-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-[13px] font-semibold text-[#1C1A14] [&::-webkit-details-marker]:hidden">
            <span className="inline-block transition-transform group-open:rotate-90">▸</span>
            Leaderboards
            <span className="font-normal text-[#766E5C]">— hottest right now, oversubscribed, closing fast, paydays, serial hosts, crowded hours</span>
          </summary>
          <div className="grid grid-cols-1 gap-3.5 pb-3 pt-3 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((b) => (
              <div key={b.key} className="rounded-[14px] border border-[#DDD3BD] bg-[#F7F2E7] p-4">
                <h3 className="text-[15px] font-bold tracking-[-0.01em] text-[#1C1A14]">{b.title}</h3>
                <p className="mt-0.5 text-[11.5px] leading-[1.35] text-[#766E5C]">{b.blurb}</p>
                <ol className="mt-3 flex flex-col gap-1.5">
                  {b.rows.map((r, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-[12.5px]">
                      <span className="w-4 shrink-0 text-right tabular-nums text-[#A79E89]">{i + 1}</span>
                      <span className="shrink-0 font-bold tabular-nums text-[#1C1A14]">{r.value}</span>
                      <span className="min-w-0 flex-1 truncate text-[#766E5C]">
                        {b.key === "venues" || b.key === "hosts" || b.key === "slots" ? (
                          r.detail
                        ) : (
                          <>
                            <a href={r.event.url || undefined} target="_blank" rel="noopener noreferrer" className="text-[#1C1A14] hover:text-[#0A8F5A] hover:underline">
                              {r.event.name}
                            </a>
                            {r.detail ? <span className="text-[#A79E89]"> · {r.detail}</span> : null}
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}
