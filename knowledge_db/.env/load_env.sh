#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# List your conf files here
FILES=("container.conf" "pg_db.conf" "pg_db_perf.conf")

# Combine and load all files from the script's directory
for file in "${FILES[@]}"; do
    if [[ -f "$SCRIPT_DIR/$file" ]]; then
        echo "Loading $SCRIPT_DIR/$file..."
        set -a
        source "$SCRIPT_DIR/$file"
        set +a
    else
        echo "Warning: $file not found in $SCRIPT_DIR, skipping..."
    fi
done

echo "Environment variables loaded from ${#FILES[@]} files"