#!/usr/bin/env bash
# Spins up a throwaway Postgres 16, applies the migrations + seed, and runs the SQL test suite.
# Usage: npm run test:sql
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  RUN_AS="runuser -u postgres --"
  chown postgres "$TMP"
fi
cleanup() { $RUN_AS "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
$RUN_AS "$PG_BIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
$RUN_AS "$PG_BIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c timezone=UTC" -l "$TMP/log" -w start >/dev/null

PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$ROOT/supabase/tests/_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ migration $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
echo "→ seed"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"
for f in "$ROOT"/supabase/tests/*.test.sql; do
  echo "→ test $(basename "$f")"
  "${PSQL[@]}" -o /dev/null -f "$f"
done
echo "→ concurrency"
bash "$ROOT/supabase/tests/race.sh" "$TMP" "$PORT"
echo "✓ SQL tests passed"
