#!/usr/bin/env sh
# Copies shared/ into the two places that ship on their own:
#   website/assets/shared   (Netlify publishes only website/)
#   extension/assets/shared (Chrome loads only extension/)
# Edit files in shared/ ONLY, then run this. It is a plain copy — not a build step.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for dest in "$ROOT/website/assets/shared" "$ROOT/extension/assets/shared"; do
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -R "$ROOT/shared/ui" "$ROOT/shared/branding" "$ROOT/shared/icons" "$dest/"
  echo "synced -> $dest"
done
