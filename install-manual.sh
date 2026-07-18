#!/usr/bin/env bash
# Manual install when "spicetify backup apply" fails (Arch Spotify ships unpacked Apps/xpui/).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
XUI="/opt/spotify/Apps/xpui"
EXT_NAME="playlist-columns.js"
CONFIG="$HOME/.config/spicetify/config-xpui.ini"
BUILT="$SCRIPT_DIR/dist/$EXT_NAME"

if [[ ! -f "$BUILT" ]]; then
  echo "Building extension..."
  (cd "$SCRIPT_DIR" && npm run build-local)
fi

if [[ ! -f "$BUILT" ]]; then
  echo "error: $BUILT not found. Run: cd $SCRIPT_DIR && npm install && npm run build-local"
  exit 1
fi

if [[ ! -d "$XUI" ]]; then
  echo "error: $XUI not found. Set spotify_path in config-xpui.ini."
  exit 1
fi

mkdir -p "$XUI/extensions"
cp -f "$BUILT" "$XUI/extensions/$EXT_NAME"
echo "Copied extension to $XUI/extensions/$EXT_NAME"

INDEX="$XUI/index.html"
if [[ ! -f "$INDEX" ]]; then
  echo "error: $INDEX not found."
  exit 1
fi

python3 - "$INDEX" "$EXT_NAME" <<'PY'
import re, sys
path, ext = sys.argv[1], sys.argv[2]
html = open(path, encoding="utf-8").read()
changed = False

if f'"{ext}"' not in html:
    html = re.sub(
        r'Spicetify\.Config\["extensions"\]\s*=\s*\[(.*?)\];',
        lambda m: f'Spicetify.Config["extensions"] = [{m.group(1)}{", " if m.group(1).strip() else ""}"{ext}"];',
        html,
        count=1,
    )
    changed = True

tag = f"<script defer src='extensions/{ext}'></script>"
if tag not in html:
    html = html.replace("</body>", f"{tag}\n</body>", 1)
    changed = True

if changed:
    open(path, "w", encoding="utf-8").write(html)
    print(f"Patched {path}")
else:
    print(f"Already registered in {path}")
PY

if [[ -f "$CONFIG" ]] && ! grep -q "playlist-columns.js" "$CONFIG"; then
  if grep -q '^extensions\s*=' "$CONFIG"; then
    sed -i 's/^extensions\s*=.*/extensions = playlist-columns.js/' "$CONFIG"
  else
    echo "extensions = playlist-columns.js" >> "$CONFIG"
  fi
  echo "Updated $CONFIG"
fi

echo ""
echo "Done. Fully quit Spotify (kill the process) and reopen it."
echo "Open a playlist — you should see a 'Columns' button in the action bar."
