#!/usr/bin/env bash
# Put secrets from the environment (or a local .dev.vars) into the
# agentfleet-api Worker. Does not print secret values.
set -euo pipefail
cd "$(dirname "$0")"

need() {
  if [ -z "${!1:-}" ]; then
    echo "missing $1 — export it or put it in .dev.vars" >&2
    exit 1
  fi
}

if [ -f .dev.vars ]; then
  # shellcheck disable=SC1091
  set -a
  # .dev.vars is KEY=VALUE; do not `source` if values contain spaces without quotes.
  # Wrangler itself reads this file for local dev; this script only uses it
  # as a convenience for the initial remote secret put.
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ""|\#*) continue ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    if [ -z "${!key:-}" ]; then
      export "$key=$value"
    fi
  done < .dev.vars
  set +a
fi

need DATABASE_URL
need AUTH_SECRET
need FREE_LLM_BASE_URL
need FREE_LLM_KEY

put() {
  printf '%s' "${!1}" | npx wrangler secret put "$1" >/dev/null
  echo "set $1"
}

put DATABASE_URL
put AUTH_SECRET
put FREE_LLM_BASE_URL
put FREE_LLM_KEY
echo "secrets uploaded for agentfleet-api"
