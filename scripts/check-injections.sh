#!/usr/bin/env bash
# Ищет в .html следы кода, внедрённого антивирусом/прокси, и подозрительные внешние скрипты.
# Использование: scripts/check-injections.sh [файл.html ...]   (без аргументов — все .html репозитория, включая /en)
# Код возврата: 0 — чисто, 1 — найдены подозрительные места.

set -u
cd "$(git rev-parse --show-toplevel 2>/dev/null || dirname "$0"/..)" || exit 2

SUSPICIOUS='kaspersky|kis\.v2\.scr|gc\.kis|127\.0\.0\.1|localhost'
ALLOWED_DOMAINS='fonts\.googleapis\.com|fonts\.gstatic\.com|www\.googletagmanager\.com|mc\.yandex\.ru|formspree\.io|med-local\.ru'

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  mapfile -t files < <(find . -name '*.html' -not -path './.git/*' -not -path './.claude/*' -not -path './node_modules/*' | sort)
fi

found=0
for f in "${files[@]}"; do
  [ -f "$f" ] || continue

  hits=$(grep -nEi "$SUSPICIOUS" "$f" || true)
  if [ -n "$hits" ]; then
    while IFS= read -r line; do
      echo "$f:${line%%:*}: подозрительная подстрока: $(echo "${line#*:}" | grep -oEi "$SUSPICIOUS" | head -1)"
    done <<< "$hits"
    found=1
  fi

  # внешние <script src=...> и <link href=...> на домены вне белого списка
  ext=$(grep -noEi '<(script|link)[^>]*(src|href)="(https?:)?//[^"/]+' "$f" || true)
  if [ -n "$ext" ]; then
    while IFS= read -r line; do
      domain=$(echo "$line" | grep -oEi '//[^"/]+$' | sed 's#^//##')
      if ! echo "$domain" | grep -Eiq "^($ALLOWED_DOMAINS)$"; then
        echo "$f:${line%%:*}: внешний ресурс вне белого списка: $domain"
        found=1
      fi
    done <<< "$ext"
  fi
done

if [ "$found" -ne 0 ]; then
  echo "check-injections: найдены подозрительные места (см. выше)" >&2
  exit 1
fi
echo "check-injections: 0 находок (проверено файлов: ${#files[@]})"
