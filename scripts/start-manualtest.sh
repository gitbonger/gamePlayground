#!/usr/bin/env bash
#
# Start the play server: the one that does not reload under you.
#
# There are two servers and the difference matters. `npm run dev` (port 5183)
# pushes every edit into whatever page is open, which is right while a change
# is being looked at and wrong entirely when you are a kilometre into a flight
# and somebody's save reloads the world out from under you. This one serves
# the same files from the same checkout -- there is no second copy of anything
# -- but once a page has loaded, nothing interrupts it. A refresh is how you
# ask for the newer code.
#
# It will not take over a port that is already busy, and it will not kill
# anything unless you say so: a server you did not mean to stop is exactly
# what this whole arrangement exists to avoid. Pass --restart when you do mean
# it.

set -euo pipefail

PORT=5199
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

usage() {
  cat <<'TXT'
start-manualtest.sh [--restart]

  Starts the play server on http://localhost:5199 — no hot reload, so a
  flight is never interrupted by an edit. Refresh the page to pick up the
  newest code.

  --restart   stop whatever is already on the port first
  --help      this
TXT
}

restart=no
for arg in "$@"; do
  case "$arg" in
    --restart) restart=yes ;;
    -h|--help) usage; exit 0 ;;
    *) echo "start-manualtest.sh: unknown option '$arg'" >&2; usage >&2; exit 2 ;;
  esac
done

# Whoever is on the port, if anyone. `lsof` is on every Mac; where it is not,
# this simply comes back empty and the server itself reports the clash.
on_port() {
  command -v lsof >/dev/null 2>&1 || return 0
  lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true
}

busy="$(on_port)"
if [ -n "$busy" ]; then
  if [ "$restart" = no ]; then
    echo "The play server is already up:  http://localhost:$PORT/"
    echo "Refresh the page to pick up the newest code."
    echo "Pass --restart if you actually want it stopped and started again."
    exit 0
  fi
  # Only ever a vite belonging to this checkout. Something else that happens
  # to be on the port is somebody else's, and killing it would be a surprise.
  for pid in $busy; do
    if ps -o command= -p "$pid" 2>/dev/null | grep -q vite; then
      echo "Stopping the play server (pid $pid)…"
      kill "$pid"
    else
      echo "Port $PORT is held by something that is not vite (pid $pid). Leaving it alone." >&2
      exit 1
    fi
  done
  # Give the port a moment to come free before asking for it again.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -z "$(on_port)" ] && break
    sleep 0.3
  done
fi

if [ ! -d node_modules ]; then
  echo "No node_modules — run 'npm install' first." >&2
  exit 1
fi

echo "Play server:  http://localhost:$PORT/"
echo "No hot reload here: refresh the page when you want the newest code."
echo "(The working server, which does reload, is 'npm run dev' on 5183.)"
echo
exec npm run play
