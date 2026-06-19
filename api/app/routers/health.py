from fastapi import APIRouter, Depends

from app.dependencies import get_db, get_llm_client, get_qdrant_repo, get_tei_client

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def health():
    return {"status": "ok", "service": "rag-system-api"}


@router.get("/healthz/ready")
async def readiness():
    return {"status": "ok", "service": "rag-system-api"}


@router.get("/healthz/live")
async def liveness(
    db=Depends(get_db),
):
    try:
        from sqlalchemy import text
        await db.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:
        db_status = "error"

    try:
        tei = await get_tei_client()
        await tei.check_availability()
        tei_status = "ok"
    except Exception:
        tei_status = "error"

    try:
        llm = await get_llm_client()
        await llm.check_availability()
        llm_status = "ok"
    except Exception:
        llm_status = "error"

    try:
        qdrant = await get_qdrant_repo()
        await qdrant.health_check()
        qdrant_status = "ok"
    except Exception:
        qdrant_status = "error"

    checks = {"database": db_status, "tei": tei_status, "llm": llm_status, "qdrant": qdrant_status}
    all_ok = all(v == "ok" for v in checks.values())

    return {
        "status": "ok" if all_ok else "degraded",
        "service": "rag-system-api",
        "checks": checks,
    }
