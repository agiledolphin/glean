#!/bin/bash
# Regenerates GleanIOS.xcodeproj from project.yml.
#
# DEVELOPMENT_TEAM is not committed (this repo is public); it's read from the
# gitignored .dev-team file if present and exported as GLEAN_DEV_TEAM before
# calling xcodegen, which substitutes it into project.yml's "${GLEAN_DEV_TEAM}".
# Without .dev-team, xcodegen still runs fine — Simulator builds don't need a
# team, only real-device builds do.
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .dev-team ]; then
  export GLEAN_DEV_TEAM
  GLEAN_DEV_TEAM="$(cat .dev-team)"
fi

xcodegen generate
