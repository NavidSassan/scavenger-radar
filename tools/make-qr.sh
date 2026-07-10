#!/usr/bin/env bash
#
# Generate a QR code that opens Scavenger Radar pre-configured with a target
# and the two access codes. Scanning it provisions a phone in one step; the
# access codes still gate the radar, so players must type the code words they
# find as physical clues in the field.
#
# The config rides in the URL fragment (#cfg=<base64url JSON>). The fragment
# stays client-side and is never sent to the server; the app strips it from the
# address bar after import. base64url keeps it URL-safe and not human-readable
# at a glance. This is obfuscation for a scout hunt, not security: the app is a
# static site, so anyone who decodes the QR can read the config.
#
# Requires: qrencode, base64 (coreutils).

set -euo pipefail

BASE_URL='https://navidsassan.github.io/scavenger-radar/'
RANGE=150
OUT='/tmp/qrcode.png'
SIZE=20

usage() {
  cat <<'EOF'
Usage: make-qr.sh LAT LON CODE1 CODE2 [options]

  LAT, LON     Target coordinate in WGS 84 decimal degrees (e.g. 47.3769 8.5417).
  CODE1 CODE2  The two access codes players must enter at the gate.

Options:
  --range M      Radar edge distance in metres (default 150).
  --out FILE     Output PNG path (default /tmp/qrcode.png).
  --size N       qrencode module size (default 20).
  --base-url URL App URL to embed (default the GitHub Pages URL).
  -h, --help     Show this help.

Example:
  ./tools/make-qr.sh 47.3769 8.5417 raven sunset --range 150 --out /tmp/qrcode.png
EOF
}

pos=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --range) RANGE="$2"; shift 2;;
    --out) OUT="$2"; shift 2;;
    --size) SIZE="$2"; shift 2;;
    --base-url) BASE_URL="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    -*) echo "Error: unknown option '$1'." >&2; usage; exit 1;;
    *) pos+=("$1"); shift;;
  esac
done

if [[ ${#pos[@]} -ne 4 ]]; then
  echo "Error: expected LAT LON CODE1 CODE2." >&2
  usage
  exit 1
fi

lat="${pos[0]}"
lon="${pos[1]}"
code1="${pos[2]}"
code2="${pos[3]}"

command -v qrencode >/dev/null 2>&1 || {
  echo "Error: qrencode not found (install the 'qrencode' package)." >&2
  exit 1
}

is_number() { [[ "$1" =~ ^-?[0-9]+([.][0-9]+)?$ ]]; }
for n in "$lat" "$lon" "$RANGE"; do
  is_number "$n" || { echo "Error: '$n' is not a number." >&2; exit 1; }
done

# Escape the characters that would otherwise break the JSON string literals.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

# Config shape must match what app.js expects in localStorage.
cfg=$(printf '{"lat":%s,"lon":%s,"word1":"%s","word2":"%s","range":%s}' \
  "$lat" "$lon" "$(json_escape "$code1")" "$(json_escape "$code2")" "$RANGE")

# base64url: standard base64, then +/ -> -_ and drop the '=' padding.
blob=$(printf '%s' "$cfg" | base64 | tr '+/' '-_' | tr -d '=\n')

url="${BASE_URL}#cfg=${blob}"

qrencode --output "$OUT" --size "$SIZE" "$url"

echo "Wrote $OUT"
echo "URL:  $url"
