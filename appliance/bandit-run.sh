#!/usr/bin/env bash
# Idempotently load the baked app image and (re)start the container.
# Invoked by bandit-app.service on boot. Safe to run repeatedly.
set -euo pipefail

IMAGE_TAR=/opt/bandit/image.tar.gz
IMAGE_NAME=bandit-web-app:latest
CONTAINER=bandit
ENV_FILE=/etc/bandit/app.env

# Load the image once (skip if it's already present from a prior boot).
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  echo "Loading $IMAGE_NAME from $IMAGE_TAR ..."
  if ! gunzip -c "$IMAGE_TAR" | docker load; then
    echo "FATAL: failed to load $IMAGE_NAME from $IMAGE_TAR" >&2
    exit 1
  fi
fi

# Start the existing container, or create it on first run.
if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  docker start "$CONTAINER"
else
  docker run -d --restart unless-stopped \
    --name "$CONTAINER" \
    -p 80:3000 \
    --env-file "$ENV_FILE" \
    "$IMAGE_NAME"
fi
