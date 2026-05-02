# Graylog logging stack

Optional centralized logging for Mimir backend. Brings up MongoDB, Elasticsearch and Graylog plus a one-shot init container that registers a global GELF TCP input.

Containers: `mimir-graylog`, `mimir-graylog-mongodb`, `mimir-graylog-elasticsearch`, `mimir-graylog-init`.

## Run via root

```bash
make up GRAYLOG=local
make logs-graylog
```

## Ports

| Port | Purpose |
| --- | --- |
| `19000` | Web UI (`http://localhost:19000`, login `admin` / `${GRAYLOG_ADMIN_PASSWORD}`) |
| `12201` | GELF TCP/UDP input |
| `1514`  | Syslog TCP/UDP |
| `5555`  | Raw TCP/UDP |

## Notes

- Idle footprint is heavy (~3 GB RAM) — use only when you need centralized logs.
- `elasticsearch_data/`, `graylog_data/`, `graylog_journal/`, `mongodb_data/` are gitignored.
