#!/usr/bin/env bash
# Two clients hit the same staff/slot at the same instant: exactly one hold must succeed.
set -uo pipefail
PSQL=(psql -h "$1" -p "$2" -U postgres -d postgres -X -q -t -A)
"${PSQL[@]}" -c "update business_hours set opens='09:00', closes='12:00', break_start=null, break_end=null where business_id='11111111-0000-4000-8000-000000000001'; delete from time_off where business_id='11111111-0000-4000-8000-000000000001';" >/dev/null
ok=0
for i in 1 2 3 4; do
  ( "${PSQL[@]}" -c "select reference from create_booking_hold('11111111-0000-4000-8000-000000000001', array['11111111-0000-4000-8000-0000000000c1']::uuid[], '11111111-0000-4000-8000-0000000000b2', '2030-01-07 10:00+00', 'Race$i', '', '+24206100000$i')" >"/tmp/kz_race_$i" 2>&1 ) &
done
wait
for i in 1 2 3 4; do grep -q '^KZ-' "/tmp/kz_race_$i" && ok=$((ok+1)); done
taken=$(grep -l 'SLOT_TAKEN' /tmp/kz_race_* | wc -l)
rm -f /tmp/kz_race_*
echo "race: $ok success, $taken SLOT_TAKEN"
[ "$ok" = "1" ] && [ "$taken" = "3" ]
