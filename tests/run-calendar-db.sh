#!/usr/bin/env bash
# Disposable local database only; never reads application environment/secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
calendar_test_dir=$(mktemp -d /tmp/sftw-calendar.XXXXXX)
cleanup() {
  pg_ctl -D "$calendar_test_dir/db" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$calendar_test_dir"
}
trap cleanup EXIT
initdb -D "$calendar_test_dir/db" -A trust --no-locale >/dev/null
pg_ctl -D "$calendar_test_dir/db" -l "$calendar_test_dir/postgres.log" -o "-k $calendar_test_dir -h '' -p 55439" -w start >/dev/null
calendar_psql=(psql -X -h "$calendar_test_dir" -p 55439 -d postgres -v ON_ERROR_STOP=1)
"${calendar_psql[@]}" -c 'create role anon; create role authenticated; create role service_role bypassrls;' >/dev/null
for migration in supabase/migrations/00002_social.sql supabase/migrations/00003_partiful_calendar.sql supabase/migrations/00004_partiful_calendar_sync.sql; do
  "${calendar_psql[@]}" -f "$migration" >/dev/null
done
"${calendar_psql[@]}" -f tests/partiful-calendar.sql
