#!/usr/bin/env bash
set -euo pipefail

SERVER="${ENGLISHJO_SERVER:-root@37.27.98.74}"
APP_DIR="${ENGLISHJO_SERVER_DIR:-/var/www/present_simple_app}"
SERVICE="${ENGLISHJO_SERVICE:-present_simple.service}"
BRANCH="${ENGLISHJO_BRANCH:-main}"
HEALTH_URL="${ENGLISHJO_HEALTH_URL:-https://eng.englishjo.com/}"
MESSAGE="${1:-Update EnglishJo}"

if ! git diff --quiet || ! git diff --cached --quiet; then
  git add -A
  git reset -- database.db 2>/dev/null || true

  if ! git diff --cached --quiet; then
    git commit -m "$MESSAGE"
  fi
fi

git push origin "$BRANCH"

STAMP="$(date +%Y%m%d-%H%M%S)"

ssh "$SERVER" "set -euo pipefail
cd '$APP_DIR'
mkdir -p backups
tar --exclude='./venv' --exclude='./__pycache__' --exclude='./backups' -czf \"backups/pre-deploy-$STAMP.tgz\" .
"

rsync -az --delete \
  --exclude '.git/' \
  --exclude 'venv/' \
  --exclude '__pycache__/' \
  --exclude 'backups/' \
  --exclude 'database.db' \
  --exclude 'static/uploads/' \
  --exclude '.DS_Store' \
  ./ "$SERVER:$APP_DIR/"

ssh "$SERVER" "set -euo pipefail
find '$APP_DIR' \
  -path '$APP_DIR/venv' -prune -o \
  -path '$APP_DIR/backups' -prune -o \
  -exec chown presentapp:presentapp {} +
'$APP_DIR/venv/bin/pip' install -r '$APP_DIR/requirements.txt'
systemctl restart '$SERVICE'
systemctl is-active --quiet '$SERVICE'
for attempt in \$(seq 1 20); do
  if curl -fsS 'http://127.0.0.1:5050/' >/dev/null; then
    break
  fi

  if [ \"\$attempt\" -eq 20 ]; then
    exit 1
  fi

  sleep 1
done
"

for attempt in $(seq 1 20); do
  if curl -fsSL "$HEALTH_URL" >/dev/null; then
    break
  fi

  if [ "$attempt" -eq 20 ]; then
    exit 1
  fi

  sleep 1
done
echo "Deployed to $SERVER:$APP_DIR and restarted $SERVICE."
