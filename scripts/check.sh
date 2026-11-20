#!/usr/bin/env bash
# quiet gate runner for bujo: ci, typecheck, build, test, test:ui. logs go to /tmp, stops at first failure.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2

for step in ci typecheck build test test:ui; do
  log="/tmp/check-$(basename "$PWD")-${step//:/-}.log"
  start=$(date +%s)
  if [ "$step" = ci ]; then cmd=(npm ci); else cmd=(npm run "$step"); fi
  if "${cmd[@]}" >"$log" 2>&1; then
    echo "ok   $step  $(( $(date +%s) - start ))s"
  else
    echo "FAIL $step  $(( $(date +%s) - start ))s  (full log: $log)"
    tail -n 30 "$log"
    exit 1
  fi
done
echo "all checks passed"
