#!/usr/bin/env bash
# quiet gate runner for bujo: ci, typecheck, build, test, ocr, test:ui. logs go to /tmp, stops at first failure.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2

# The python tests need only requirements-test.txt (the gateway is faked locally).
# The venv is recreated when that file changes (its hash is kept next to it).
ocr_tests() {
  local venv=ocr/.venv-test
  local want
  want=$(sha256sum ocr/requirements-test.txt | cut -d' ' -f1)
  if [ ! -x "$venv/bin/python" ] || [ "$(cat "$venv/.req-hash" 2>/dev/null)" != "$want" ]; then
    rm -rf "$venv"
    python3 -m venv "$venv" || return 1
    "$venv/bin/pip" install --quiet --disable-pip-version-check -r ocr/requirements-test.txt || return 1
    echo "$want" >"$venv/.req-hash"
  fi
  (cd ocr && .venv-test/bin/python -m pytest -q)
}

for step in ci typecheck build test ocr test:ui; do
  log="/tmp/check-$(basename "$PWD")-${step//:/-}.log"
  start=$(date +%s)
  case "$step" in
    ci) cmd=(npm ci) ;;
    ocr) cmd=(ocr_tests) ;;
    *) cmd=(npm run "$step") ;;
  esac
  if "${cmd[@]}" >"$log" 2>&1; then
    echo "ok   $step  $(( $(date +%s) - start ))s"
  else
    echo "FAIL $step  $(( $(date +%s) - start ))s  (full log: $log)"
    tail -n 30 "$log"
    exit 1
  fi
done
echo "all checks passed"
