## Document Ingestion / Parsing Service

This component accepts raw document files (PDF, DOCX, TXT, etc.) and returns their extracted content (currently plain text).

We use [Docling](https://github.com/docling-project/docling) (modern Python library for high-quality document parsing and structured text extraction) as the parsing engine.  
For deployment, we use [Docling Serve](https://github.com/docling-project/docling-serve), which wraps the Docling library with a simple HTTP API server.

The easiest way to deploy this component is by using the pre-built Docker container:

```bash
docker run -d \
  --name docling-serve \
  --restart unless-stopped \
  -p 5001:5001 \
  -e DOCLING_SERVE_ENABLE_UI=1 \
  quay.io/docling-project/docling-serve
```