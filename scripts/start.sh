#!/usr/bin/env bash
#
# Start the game: http://localhost:5199/
#
# The short name to reach for when you just want to play. The server itself,
# and the reasons it works the way it does, are in start-manualtest.sh next
# door -- this only saves you remembering that name. Options are passed
# straight on; --restart is the useful one.

exec bash "$(dirname "${BASH_SOURCE[0]}")/start-manualtest.sh" "$@"
