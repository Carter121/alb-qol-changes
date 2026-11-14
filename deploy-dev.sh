
#!/usr/bin/env bash
set -euo pipefail

# Always run from the repository root
cd "$(dirname "$0")"

# Load deployment configuration
if [[ ! -f .env ]]; then
    echo "Error: .env file not found"
    exit 1
fi

set -a
source .env
set +a

# Verify required variables
: "${DEPLOY_SSH_HOST:?Missing DEPLOY_SSH_HOST in .env}"
: "${DEPLOY_REMOTE_PATH:?Missing DEPLOY_REMOTE_PATH in .env}"

# Build development userscript
echo "Building development userscript..."
pnpm build:dev

# Upload to Caddy
echo "Deploying to ${DEPLOY_SSH_HOST}..."

scp \
    -P "${DEPLOY_SSH_PORT:-22}" \
    dist/alb-qol-changes.user.js \
    "${DEPLOY_SSH_HOST}:${DEPLOY_REMOTE_PATH}"

echo "Development userscript deployed successfully!"
