#!/bin/bash
# Print the owner's outstanding to-do items at the start of every session.
#
# These are account, paperwork and verification tasks that no session can
# finish, several with lead times measured in weeks. They live in
# OWNER-TODO.md; this hook surfaces the unchecked ones so the owner does
# not have to remember where the list is or go back to the chat that
# produced it.
#
# Deliberately quiet: no network, no installs, no failure that could block
# a session from starting. If the list is missing or complete, it says
# nothing beyond a single line.
set -uo pipefail

TODO="${CLAUDE_PROJECT_DIR:-.}/OWNER-TODO.md"
[ -f "$TODO" ] || exit 0

# Unchecked items, under whichever heading they sit below. The heading is
# printed once, and only if something under it is still open.
PENDING=$(awk '
  /^## / { heading = substr($0, 4); printed = 0; next }
  /^- \[ \]/ {
    if (!printed) { print ""; print heading ":"; printed = 1 }
    line = $0
    sub(/^- \[ \] /, "  - ", line)
    gsub(/\*\*/, "", line)
    print line
    next
  }
  /^      / {
    if (printed) {
      cont = $0
      sub(/^ +/, "    ", cont)
      gsub(/\*\*/, "", cont)
      print cont
    }
  }
' "$TODO")

if [ -z "$PENDING" ]; then
  echo "OWNER-TODO.md: nothing outstanding."
  exit 0
fi

cat <<BANNER
=== Owner to-do, from OWNER-TODO.md ===

Relay this list to the owner near the start of your first reply, briefly,
before getting into whatever they asked for. These are tasks only they can
do, several with lead times of weeks. Do not re-explain the reasoning
unless asked; VIABILITY.md has it. Do not tick the boxes yourself; the
owner does that, or asks you to.
$PENDING

=== end owner to-do ===
BANNER
