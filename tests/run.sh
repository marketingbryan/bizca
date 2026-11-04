#!/usr/bin/env bash
# Runs every Bizca test: backend (no database needed) and frontend (jsdom).
#   cd tests && npm install && npm test
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
fail=0

echo "== Backend =="
for f in "$HERE"/../server/*.test.js; do
  name=$(basename "$f")
  out=$(cd "$HERE/../server" && node "$name" 2>&1)
  line=$(echo "$out" | grep -E "passed|passati" | tail -1)
  if echo "$line" | grep -qE " 0 (failed|falliti)"; then echo "  ok    $name  — $line"
  else echo "  FAIL  $name"; echo "$out" | grep -E "FAIL" | head -5; fail=1; fi
done

echo "== Frontend =="
for f in "$HERE"/*.test.js; do
  name=$(basename "$f")
  out=$(node "$f" 2>&1 | grep -v "Not implemented")
  if echo "$out" | grep -qE "FALLIT|FAIL|CRASH"; then echo "  FAIL  $name"; echo "$out" | grep -E "FAIL|CRASH" | head -5; fail=1
  else echo "  ok    $name"; fi
done

[ $fail -eq 0 ] && echo "All green." || echo "Some tests failed."
exit $fail
