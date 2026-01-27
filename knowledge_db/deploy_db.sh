#!/bin/bash

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load environment variables from .env directory
if [ -f "$SCRIPT_DIR/.env/load_env.sh" ]; then
    echo "Loading environment variables..."
    . "$SCRIPT_DIR/.env/load_env.sh"
else
    echo "Error: load_env.sh not found at $SCRIPT_DIR/.env/load_env.sh!"
    exit 1
fi
# Stop and remove containers and volumes
docker-compose down -v
# Deploy with docker-compose
echo "Starting Docker Compose..."
docker-compose up -d