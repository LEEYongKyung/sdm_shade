#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/Workspace/sdm_shade/shade-priority-app}"
REPO_DIR="${REPO_DIR:-$(dirname "$APP_DIR")}"
BRANCH="${BRANCH:-main}"
WEB_ROOT="${WEB_ROOT:-/var/www/sdm-shade}"
PM2_NAME="${PM2_NAME:-sdm-shade-api}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:5174/api/health}"
SKIP_PULL="${SKIP_PULL:-0}"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Required file not found: $1" >&2
    exit 1
  fi
}

log "Using repository: $REPO_DIR"
log "Using app directory: $APP_DIR"

if [[ "$SKIP_PULL" != "1" ]]; then
  log "Pulling latest source from origin/$BRANCH"
  cd "$REPO_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
fi

cd "$APP_DIR"
require_file "$APP_DIR/.env"

log "Installing npm dependencies"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

log "Building React frontend"
npm run build

log "Publishing dist to $WEB_ROOT"
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete "$APP_DIR/dist/" "$WEB_ROOT/"
sudo chown -R www-data:www-data "$WEB_ROOT"

log "Restarting PM2 process: $PM2_NAME"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
else
  pm2 start "$APP_DIR/server/index.js" --name "$PM2_NAME" --cwd "$APP_DIR"
fi
pm2 save

log "Reloading Nginx"
sudo nginx -t
sudo systemctl reload nginx

log "Checking API health"
for attempt in {1..10}; do
  if curl -fsS "$API_HEALTH_URL"; then
    printf '\n'
    log "Deploy completed"
    exit 0
  fi
  echo "Health check failed, retrying ($attempt/10)..."
  sleep 2
done

echo "API health check failed after retries" >&2
exit 1
