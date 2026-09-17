import { TechWeekPage } from "@/components/techweek-page";

// 30 min — aligned with the chat's 1h prompt cache. The snapshot only changes
// when scripts/scrape-techweek.mjs runs, so regenerating more often buys nothing.
export const revalidate = 1800;

export default function Home() {
  return <TechWeekPage city="sf" />;
}
