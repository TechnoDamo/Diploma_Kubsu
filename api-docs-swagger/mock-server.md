# Mock Server

Schema: `specs/comparison-service.yaml`

Start Prism mock server:

```bash
cd /Users/damir/Documents/Diploma_Kubsu/api-docs-swagger
docker compose up prism
```

Run it in background:

```bash
cd /Users/damir/Documents/Diploma_Kubsu/api-docs-swagger
docker compose up -d prism
```

Open Swagger UI:

```bash
cd /Users/damir/Documents/Diploma_Kubsu/api-docs-swagger
docker compose up swagger-ui
```

Mock base URL:

```text
http://localhost:8080/api/v1
```

Smoke test:

```bash
curl http://localhost:8080/api/v1/projects
```

Stop everything:

```bash
cd /Users/damir/Documents/Diploma_Kubsu/api-docs-swagger
docker compose down
```
