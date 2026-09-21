#!/bin/bash
# Hype Radar tazeleme: yeni snapshot topla -> skorla -> paneli yeniden derle
# -> yayımlanmış Artifact'i AYNI URL üzerinde güncelle.
# launchd 2 günde bir çağırır; elle de çalıştırılabilir: ./refresh.sh
set -uo pipefail
cd "$(dirname "$0")"

ARTIFACT_URL="https://claude.ai/artifact/Gosp4EqcjQ1bPso98dXKig"
LOG="data/refresh.log"
say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

say "tazeleme başladı"

if ! node src/collect.js "otomatik tazeleme" >> "$LOG" 2>&1; then
  say "HATA: toplama başarısız — panel dokunulmadan bırakıldı"
  exit 1
fi

if ! node src/publish.js >> "$LOG" 2>&1; then
  say "HATA: panel derlenemedi"
  exit 1
fi
say "panel derlendi: web/dashboard.html"

# Yayın adımı Claude CLI gerektirir. Yoksa yerel dosya yine güncel kalır.
if command -v claude >/dev/null 2>&1; then
  if claude -p "Republish the artifact at $ARTIFACT_URL from the local file $(pwd)/web/dashboard.html using the Artifact tool with that url. Do not change anything else. Reply with just the word OK." \
      --allowedTools Artifact >> "$LOG" 2>&1; then
    say "Artifact güncellendi: $ARTIFACT_URL"
  else
    say "UYARI: Artifact yayını başarısız — yerel panel güncel, yayın elle yapılmalı"
  fi
else
  say "UYARI: claude CLI yok — yalnız yerel panel güncellendi"
fi

say "tazeleme bitti"
