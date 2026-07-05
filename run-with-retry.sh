#!/bin/bash
# Run a command with optional session pre-check, retry-on-failure,
# session-expiry detection, and per-attempt timeout.
#
# Usage:
#   run-with-retry.sh [--precheck CMD ARG... --] CMD [ARG...]
#
# Behavior:
#   - Optional precheck: if `--precheck ... --` is given, run that first.
#       precheck fails (non-zero exit) -> notify, skip main, exit 75.
#   - Main command: stdin=/dev/null (no interactive prompts).
#       Wrapped in a 30-minute hard timeout (kill if it hangs).
#   - Output is captured AND forwarded. After it ends, search for
#     session-expiry keywords -> notify + skip retry (exit 75).
#   - Other failures -> wait 30 minutes, retry once.

ATTEMPT_TIMEOUT_SECS=1800       # 30 min hard cap per attempt
RETRY_BACKOFF_SECS=1800         # 30 min between attempts
SESSION_RE='세션 만료|재로그인|로그인이 필요|로그인 후 엔터|로그인 완료 후|NID_AUT 쿠키.*없음'

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[run-with-retry $(ts)] $*" >&2; }

# Parse optional --precheck ... --
PRECHECK=()
if [ "$1" = "--precheck" ]; then
  shift
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do
    PRECHECK+=("$1"); shift
  done
  if [ "$1" = "--" ]; then shift; fi
fi

LABEL_HINT="$(basename "${1:-blog-auto}") $(basename "${2:-}")"

TMP_OUT=$(mktemp -t blog-auto-retry.XXXXXX)
trap 'rm -f "$TMP_OUT"' EXIT

notify() {
  local msg="$1"
  /usr/bin/osascript -e "display notification \"$msg\" with title \"blog-auto\" subtitle \"$LABEL_HINT\" sound name \"Glass\"" >/dev/null 2>&1 || true
}

run_with_timeout() {
  : > "$TMP_OUT"
  "$@" </dev/null > >(tee -a "$TMP_OUT") 2> >(tee -a "$TMP_OUT" >&2) &
  local child_pid=$!
  ( sleep "$ATTEMPT_TIMEOUT_SECS"; kill -TERM $child_pid 2>/dev/null; sleep 5; kill -KILL $child_pid 2>/dev/null ) &
  local watcher_pid=$!
  wait $child_pid 2>/dev/null
  local code=$?
  kill $watcher_pid 2>/dev/null
  wait 2>/dev/null
  return $code
}

# 1) precheck
if [ ${#PRECHECK[@]} -gt 0 ]; then
  log "running precheck: ${PRECHECK[*]}"
  PRECHECK_OUT=$("${PRECHECK[@]}" 2>&1)
  PRECHECK_CODE=$?
  echo "$PRECHECK_OUT" >&2
  if [ $PRECHECK_CODE -ne 0 ]; then
    log "precheck failed (exit=$PRECHECK_CODE) -> notify, skip main."
    notify "세션 만료 - 수동 로그인 필요 (npm run login-naver)"
    exit 75
  fi
fi

# 2) main attempt
run_with_timeout "$@"
EXIT_CODE=$?

if grep -qE "$SESSION_RE" "$TMP_OUT"; then
  log "session expiry detected on first attempt -> notify, skip retry."
  notify "세션 만료 - 수동 로그인 필요 (npm run login-naver)"
  exit 75
fi

if [ $EXIT_CODE -ne 0 ]; then
  log "first attempt failed (exit=$EXIT_CODE). retrying in $((RETRY_BACKOFF_SECS/60)) minutes..."
  sleep "$RETRY_BACKOFF_SECS"
  log "retrying now..."
  run_with_timeout "$@"
  EXIT_CODE=$?

  if grep -qE "$SESSION_RE" "$TMP_OUT"; then
    log "session expiry detected on retry -> notify."
    notify "세션 만료 - 수동 로그인 필요 (npm run login-naver)"
    exit 75
  fi

  if [ $EXIT_CODE -ne 0 ]; then
    log "retry also failed (exit=$EXIT_CODE). giving up."
  else
    log "retry succeeded."
  fi
fi

exit $EXIT_CODE
