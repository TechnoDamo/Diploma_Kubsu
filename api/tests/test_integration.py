"""
End-to-end integration test for the Mimir API.

Usage:
    make up          # start the stack first
    make test        # run this test suite
    make down        # cleanup

Requires:
    - API running on http://localhost:8080
    - Postgres + Qdrant + Docling running
"""

import asyncio
import sys
import time as time_mod
from datetime import datetime

import httpx
import pytest

BASE = "http://localhost:8080"
TEST_DOCS_DIR = "scripts/test_docs"

PDF_DOCS = [
    "business_continuity_program.pdf",
    "records_retention_standard.pdf",
]

ALL_FORMAT_DOCS = [
    ("sample_plain.txt", "text/plain"),
    ("sample_markdown.md", "text/markdown"),
    ("sample_html.html", "text/html"),
    ("sample_docx.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ("business_continuity_program.pdf", "application/pdf"),
]


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", file=sys.stderr, flush=True)


def api(path: str) -> str:
    return f"{BASE}/api/v1{path}"


async def wait_for_api(timeout: int = 30) -> bool:
    log("Waiting for API...")
    deadline = time_mod.time() + timeout
    async with httpx.AsyncClient() as client:
        while time_mod.time() < deadline:
            try:
                r = await client.get(f"{BASE}/healthz", timeout=3)
                if r.status_code == 200:
                    log("API is ready")
                    return True
            except Exception:
                pass
            await asyncio.sleep(1)
    log("API never became ready")
    return False


async def wait_for_document(client: httpx.AsyncClient, project_id: int, doc_id: int, timeout: int = 120) -> str:
    log(f"  Waiting for document {doc_id} to index (timeout={timeout}s)...")
    deadline = time_mod.time() + timeout
    elapsed = 0
    while time_mod.time() < deadline:
        r = await client.get(api(f"/projects/{project_id}/documents/{doc_id}"))
        if r.status_code == 200:
            status = r.json()["status"]
            if status in ("indexed", "failed"):
                log(f"  Document {doc_id}: {status} (after {elapsed}s)")
                return status
        await asyncio.sleep(2)
        elapsed += 2
    log(f"  Document {doc_id}: timeout after {elapsed}s")
    return "timeout"


async def wait_for_analysis(client: httpx.AsyncClient, project_id: int, job_id: int, timeout: int = 180) -> str:
    log(f"  Waiting for analysis job {job_id} to complete (timeout={timeout}s)...")
    deadline = time_mod.time() + timeout
    elapsed = 0
    while time_mod.time() < deadline:
        r = await client.get(api(f"/projects/{project_id}/analysis/contradictions/{job_id}"))
        if r.status_code == 200:
            data = r.json()
            if data["status"] in ("completed", "failed"):
                log(f"  Analysis job {job_id}: {data['status']} (after {elapsed}s)")
                return data["status"]
        await asyncio.sleep(3)
        elapsed += 3
    log(f"  Analysis job {job_id}: timeout after {elapsed}s")
    return "timeout"


@pytest.fixture(scope="module")
async def api_ready():
    if not await wait_for_api(30):
        pytest.skip("API is not reachable — run `make up` first")
    return True


@pytest.mark.asyncio
async def test_health(api_ready: bool):
    assert api_ready
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{BASE}/healthz")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_full_pipeline(api_ready: bool):
    assert api_ready
    log("=== Full pipeline test started ===")
    start = time_mod.time()

    async with httpx.AsyncClient(timeout=120) as client:
        project_id = None
        doc_ids: list[int] = []

        try:
            # 1. Create project
            log("[1] Creating project...")
            r = await client.post(
                api("/projects"),
                json={"name": f"integration-test-{int(time_mod.time())}", "description": "auto-test"},
            )
            assert r.status_code in (200, 201), f"Create project failed: {r.text}"
            project = r.json()
            project_id = project["id"]
            log(f"  Created project id={project_id}")

            # 2. List projects
            log("[2] Listing projects...")
            r = await client.get(api("/projects"))
            assert r.status_code == 200
            projects = r.json()
            assert any(p["id"] == project_id for p in projects["items"])
            log(f"  Found {projects['total']} projects")

            # 3. Get single project
            log("[3] Getting project details...")
            r = await client.get(api(f"/projects/{project_id}"))
            assert r.status_code == 200

            # 4. Upload PDF documents
            for doc_name in PDF_DOCS:
                log(f"[4] Uploading {doc_name}...")
                path = f"{TEST_DOCS_DIR}/{doc_name}"
                with open(path, "rb") as f:
                    r = await client.post(
                        api(f"/projects/{project_id}/documents"),
                        data={"display_name": doc_name},
                        files={"file": (doc_name, f, "application/pdf")},
                    )
                assert r.status_code in (200, 201), f"Upload {doc_name} failed: {r.text}"
                doc = r.json()
                doc_ids.append(doc["id"])
                log(f"  Uploaded document id={doc['id']} status={doc['status']}")

            # 5. List documents
            log("[5] Listing documents...")
            r = await client.get(api(f"/projects/{project_id}/documents"))
            assert r.status_code == 200
            docs = r.json()
            log(f"  {docs['total']} documents in project")

            # 6. Wait for indexing (slow — Docling parses PDFs on CPU)
            log("[6] Waiting for indexing (Docling PDF parsing — may take several minutes)...")
            for did in doc_ids:
                status = await wait_for_document(client, project_id, did, timeout=600)
                assert status == "indexed", f"Document {did} failed indexing: {status}"

            # 7. Get document text
            log("[7] Getting document text...")
            r = await client.get(api(f"/projects/{project_id}/documents/{doc_ids[0]}/text"))
            assert r.status_code == 200
            text_data = r.json()
            log(f"  Text length: {len(text_data.get('text', ''))} chars")

            # 8. Get document content (binary)
            log("[8] Getting document content (binary)...")
            r = await client.get(api(f"/projects/{project_id}/documents/{doc_ids[0]}/content"))
            assert r.status_code == 200
            log(f"  Binary size: {len(r.content)} bytes")

            # 9. RAG query
            log("[9] Running RAG query...")
            r = await client.post(
                api(f"/projects/{project_id}/rag/query"),
                json={"question": "What is the business continuity plan?"},
            )
            assert r.status_code == 200, f"RAG query failed: {r.text}"
            rag_result = r.json()
            log(f"  Answer length: {len(rag_result.get('answer', ''))} chars")
            log(f"  Citations: {len(rag_result.get('citations', []))}")

            # 10. RAG query with target document filter
            log("[10] Running RAG query with document filter...")
            r = await client.post(
                api(f"/projects/{project_id}/rag/query"),
                json={
                    "question": "What records retention policy exists?",
                    "target_document_ids": [doc_ids[0]],
                },
            )
            assert r.status_code == 200, f"RAG query with filter failed: {r.text}"

            # 11. Start contradiction analysis
            log("[11] Starting contradiction analysis...")
            r = await client.post(
                api(f"/projects/{project_id}/analysis/contradictions"),
                json={
                    "base_document_id": doc_ids[0],
                    "target_document_ids": doc_ids[1:],
                },
            )
            assert r.status_code == 202, f"Start analysis failed: {r.text}"
            analysis_result = r.json()
            job_id = analysis_result["job_id"]
            log(f"  Analysis job id={job_id} started")

            # 12. Wait for analysis
            job_status = await wait_for_analysis(client, project_id, job_id, timeout=300)
            assert job_status == "completed", f"Analysis job failed: {job_status}"

            # 13. Get analysis results
            log("[13] Getting analysis results...")
            r = await client.get(api(f"/projects/{project_id}/analysis/contradictions/{job_id}"))
            assert r.status_code == 200
            analysis_data = r.json()
            results = analysis_data.get("results", [])
            log(f"  Contradiction groups found: {len(results)}")

        finally:
            # 14. Cleanup — delete documents
            if project_id and doc_ids:
                log("[14] Cleaning up — deleting documents...")
                for did in doc_ids:
                    try:
                        r = await client.delete(api(f"/projects/{project_id}/documents/{did}"))
                        if r.status_code not in (200, 204):
                            log(f"  Warning: could not delete doc {did} (status={r.status_code}, may have active job)")
                        else:
                            log(f"  Deleted document {did}")
                    except Exception as e:
                        log(f"  Warning: delete doc {did} failed: {e}")

            # 15. Delete project
            if project_id:
                log("[15] Deleting project...")
                try:
                    r = await client.delete(api(f"/projects/{project_id}"))
                    log(f"  Delete project: {r.status_code}")
                except Exception as e:
                    log(f"  Warning: delete project failed: {e}")

    elapsed = int(time_mod.time() - start)
    log(f"=== Full pipeline test finished in {elapsed}s ===")


@pytest.mark.asyncio
async def test_health_endpoints(api_ready: bool):
    assert api_ready
    async with httpx.AsyncClient() as client:
        for path in ["/healthz", "/healthz/ready"]:
            r = await client.get(f"{BASE}{path}")
            assert r.status_code == 200


@pytest.mark.asyncio
async def test_all_document_formats(api_ready: bool):
    assert api_ready
    log("=== All formats test started ===")
    start = time_mod.time()

    async with httpx.AsyncClient(timeout=120) as client:
        project_id = None
        doc_ids: list[int] = []

        try:
            r = await client.post(
                api("/projects"),
                json={"name": f"formats-test-{int(time_mod.time())}", "description": "multi-format-test"},
            )
            assert r.status_code in (200, 201), f"Create project failed: {r.text}"
            project_id = r.json()["id"]
            log(f"  Created project id={project_id}")

            for doc_name, mime_type in ALL_FORMAT_DOCS:
                log(f"  Uploading {doc_name} ({mime_type})...")
                path = f"{TEST_DOCS_DIR}/{doc_name}"
                with open(path, "rb") as f:
                    r = await client.post(
                        api(f"/projects/{project_id}/documents"),
                        data={"display_name": doc_name},
                        files={"file": (doc_name, f, mime_type)},
                    )
                assert r.status_code in (200, 201), f"Upload {doc_name} failed: {r.text}"
                doc = r.json()
                doc_ids.append(doc["id"])
                log(f"    Document id={doc['id']}")

            for did in doc_ids:
                status = await wait_for_document(client, project_id, did, timeout=600)
                assert status == "indexed", f"Document {did} failed: {status}"

            for did in doc_ids:
                r = await client.get(api(f"/projects/{project_id}/documents/{did}/text"))
                assert r.status_code == 200
                text_len = len(r.json().get("text", ""))
                assert text_len > 0, f"Document {did} has empty text"
                log(f"    doc_id={did} text_length={text_len}")

        finally:
            if project_id and doc_ids:
                log("  Cleaning up...")
                for did in doc_ids:
                    try:
                        await client.delete(api(f"/projects/{project_id}/documents/{did}"))
                    except Exception:
                        pass
            if project_id:
                try:
                    await client.delete(api(f"/projects/{project_id}"))
                except Exception:
                    pass

    elapsed = int(time_mod.time() - start)
    log(f"=== All formats test finished in {elapsed}s ===")
