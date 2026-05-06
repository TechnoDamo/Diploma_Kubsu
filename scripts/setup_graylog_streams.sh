#!/bin/sh
# Set up Graylog streams for Mimir
# Run after Graylog is up: curl -s http://localhost:19000/api/system/lbstatus

GRAYLOG_URL="http://localhost:19000"
AUTH="admin:admin"

wait_for_graylog() {
    for i in $(seq 60); do
        if curl -s -u "$AUTH" "$GRAYLOG_URL/api/system/lbstatus" > /dev/null 2>&1; then
            echo "Graylog is ready"
            return 0
        fi
        sleep 5
    done
    echo "Graylog not ready"
    return 1
}

create_stream() {
    local TITLE="$1"
    local DESCRIPTION="$2"
    local RULES="$3"
    
    STREAM_ID=$(curl -s -u "$AUTH" -X POST "$GRAYLOG_URL/api/streams" \
        -H "Content-Type: application/json" \
        -H "X-Requested-By: cli" \
        -d "{\"title\":\"$TITLE\",\"description\":\"$DESCRIPTION\",\"index_set_id\":\"$(curl -s -u "$AUTH" "$GRAYLOG_URL/api/system/indices/index_sets" | python3 -c "import sys,json; print(json.load(sys.stdin)['index_sets'][0]['id'])")\"}" \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('stream_id',''))" 2>/dev/null)
    
    if [ -n "$STREAM_ID" ]; then
        echo "Created stream '$TITLE' (id=$STREAM_ID)"
        
        # Add rule
        echo "$RULES" | while IFS='|' read -r field type value; do
            if [ -n "$field" ]; then
                curl -s -u "$AUTH" -X POST "$GRAYLOG_URL/api/streams/$STREAM_ID/rules" \
                    -H "Content-Type: application/json" \
                    -H "X-Requested-By: cli" \
                    -d "{\"field\":\"$field\",\"type\":$type,\"value\":\"$value\",\"inverted\":false}" > /dev/null
            fi
        done
        
        # Resume stream
        curl -s -u "$AUTH" -X POST "$GRAYLOG_URL/api/streams/$STREAM_ID/resume" \
            -H "X-Requested-By: cli" > /dev/null
    fi
}

wait_for_graylog || exit 1

# Create streams with rules
create_stream "Mimir API Requests" "HTTP request/response logs" \
"logger_name|1|app.main"

create_stream "Mimir Document Processing" "Document upload and indexing operations" \
"logger_name|1|app.services.documents
logger_name|1|app.services.indexing"

create_stream "Mimir Analysis" "Contradiction analysis jobs" \
"logger_name|1|app.services.analysis"

create_stream "Mimir Errors" "All error-level events" \
"level|1|ERROR"

create_stream "Mimir All" "All Mimir application logs" \
"facility|1|mimir"

echo "Graylog streams configured"
