#!/usr/bin/env bash
# Unattended runner for the SF scrape while tech-week.com has our IP blocked on
# /go/event/. Every PROBE_EVERY seconds it clicks ONE link; once that succeeds
# it runs the full scrape at a gentle pace. The scraper itself stops clicking
# again if it detects a fresh block, so this loops until every link is known.
#
#   nohup caffeinate -i scripts/resume-when-unblocked.sh > data/sf-resume.log 2>&1 &
# (caffeinate keeps the Mac from idle-sleeping; the run takes hours because
# tech-week.com allows roughly 150 redirect clicks per hour per IP.)
set -u
cd "$(dirname "$0")/.."
CITY="${CITY:-sf}"
PACE_MS="${PACE_MS:-6000}"        # observed budget is ~150 clicks per rolling hour; blocks last ~10 min
PROBE_EVERY="${PROBE_EVERY:-600}" # seconds between probes while blocked
MAX_ROUNDS="${MAX_ROUNDS:-60}"

ts() { date "+%H:%M:%S"; }
unresolved() {
  node -e '
    const ev=require("./data/'"$CITY"'-events.json").events;
    const l=require("./data/'"$CITY"'-links.json");
    console.log(ev.filter(e=>e.goHref&&e.goHref.startsWith("/go/event/")&&!l[e.id]).length)'
}

for round in $(seq 1 "$MAX_ROUNDS"); do
  left=$(unresolved)
  echo "$(ts) round $round: $left links unresolved"
  if [ "$left" = "0" ]; then
    echo "$(ts) all links resolved — final full run"
    node scripts/scrape-techweek.mjs "$CITY" --list-only
    exit 0
  fi
  # Probe until the block lifts.
  until node scripts/scrape-techweek.mjs "$CITY" --probe --no-upload 2>&1 | grep -q "block lifted"; do
    echo "$(ts) still blocked; next probe in ${PROBE_EVERY}s"
    sleep "$PROBE_EVERY"
  done
  echo "$(ts) block lifted — resuming at ${PACE_MS}ms per click"
  node scripts/scrape-techweek.mjs "$CITY" --pace "$PACE_MS"
  echo "$(ts) scrape run finished (exit $?)"
  sleep 30
done
echo "$(ts) gave up after $MAX_ROUNDS rounds"
exit 1
