from __future__ import annotations

from html import escape
from pathlib import Path


OUT = Path(__file__).resolve().parents[1] / "docs"
SVG_PATH = OUT / "rag-system-erd.svg"

W = 3508
H = 2480


TABLES = {
    "projects": {
        "schema": "documents",
        "x": 1170,
        "y": 260,
        "w": 690,
        "accent": "#1d4ed8",
        "cols": [
            ("PK", "id", "bigserial"),
            ("UQ", "name", "text"),
            ("", "description", "text"),
            ("", "state", "text"),
            ("", "created_at", "timestamptz"),
            ("", "updated_at", "timestamptz"),
        ],
    },
    "project_index_configs": {
        "schema": "documents",
        "x": 130,
        "y": 535,
        "w": 820,
        "accent": "#2563eb",
        "cols": [
            ("PK", "id", "bigserial"),
            ("FK", "project_id", "bigint"),
            ("UQ", "version", "integer"),
            ("", "is_active", "boolean"),
            ("", "embedding_model_name", "text"),
            ("", "embedding_dimension", "integer"),
            ("", "parser_settings", "group"),
            ("", "chunking_settings", "group"),
            ("", "rag_retrieval_settings", "group"),
            ("", "contradiction_settings", "group"),
            ("", "created_at / activated_at", "time"),
        ],
    },
    "documents": {
        "schema": "documents",
        "x": 1120,
        "y": 625,
        "w": 760,
        "accent": "#0f766e",
        "cols": [
            ("PK", "id", "bigserial"),
            ("FK", "project_id", "bigint"),
            ("", "name", "text"),
            ("EXT", "storage_key", "text"),
            ("", "size_bytes", "bigint"),
            ("", "mime_type", "text"),
            ("", "sha256", "text"),
            ("", "status", "text"),
            ("FK", "indexed_config_id", "bigint"),
            ("", "summary", "text"),
            ("", "failure_reason", "text"),
            ("", "created_at / updated_at", "time"),
        ],
    },
    "chunks": {
        "schema": "documents",
        "x": 1120,
        "y": 1295,
        "w": 760,
        "accent": "#0891b2",
        "cols": [
            ("PK", "id", "bigserial"),
            ("FK", "document_id", "bigint"),
            ("FK", "project_id", "bigint"),
            ("FK", "index_config_id", "bigint"),
            ("EXT", "qdrant_point_id", "uuid"),
            ("UQ", "chunk_order", "integer"),
            ("", "text", "text"),
            ("", "char_start", "integer"),
            ("", "char_end", "integer"),
            ("", "token_count / page_number", "integer"),
            ("", "created_at", "timestamptz"),
        ],
    },
    "document_processing_jobs": {
        "schema": "documents",
        "x": 130,
        "y": 1625,
        "w": 820,
        "accent": "#7c3aed",
        "cols": [
            ("PK", "id", "bigserial"),
            ("FK", "project_id", "bigint"),
            ("FK", "document_id", "bigint"),
            ("", "kind", "text"),
            ("", "status", "text"),
            ("FK", "target_index_config_id", "bigint"),
            ("", "attempt_count", "integer"),
            ("", "last_error", "text"),
            ("", "claimed_by / claimed_at", "claim"),
            ("", "created_at / updated_at", "time"),
            ("", "completed_at", "timestamptz"),
        ],
    },
    "document_history": {
        "schema": "documents",
        "x": 2090,
        "y": 1510,
        "w": 660,
        "accent": "#ea580c",
        "cols": [
            ("PK", "id", "bigserial"),
            ("FK", "document_id", "bigint"),
            ("", "operation", "text"),
            ("", "details", "json"),
            ("", "created_at", "timestamptz"),
        ],
    },
    "analysis_jobs": {
        "schema": "analysis",
        "x": 2225,
        "y": 560,
        "w": 760,
        "accent": "#16a34a",
        "cols": [
            ("PK", "id", "bigserial"),
            ("FK", "project_id", "bigint"),
            ("FK", "base_document_id", "bigint"),
            ("", "status", "text"),
            ("", "warning_message", "text"),
            ("", "error_message", "text"),
            ("", "results", "json"),
            ("", "attempt_count", "integer"),
            ("", "claimed_by / claimed_at", "claim"),
            ("", "created_at / updated_at", "time"),
            ("", "completed_at", "timestamptz"),
        ],
    },
    "analysis_job_targets": {
        "schema": "analysis",
        "x": 2830,
        "y": 1360,
        "w": 520,
        "accent": "#15803d",
        "cols": [
            ("PK/FK", "job_id", "bigint"),
            ("PK/FK", "document_id", "bigint"),
        ],
    },
    "alembic_version": {
        "schema": "public",
        "x": 2775,
        "y": 2015,
        "w": 540,
        "accent": "#64748b",
        "cols": [
            ("PK", "version_num", "varchar(32)"),
        ],
    },
}


LINKS = [
    ("project_index_configs", "projects", "#2563eb", "project_id"),
    ("documents", "projects", "#0f766e", "project_id"),
    ("documents", "project_index_configs", "#0f766e", "indexed_config_id"),
    ("chunks", "documents", "#0891b2", "document_id"),
    ("chunks", "projects", "#0891b2", "project_id"),
    ("chunks", "project_index_configs", "#0891b2", "index_config_id"),
    ("document_processing_jobs", "projects", "#7c3aed", "project_id"),
    ("document_processing_jobs", "documents", "#7c3aed", "document_id"),
    ("document_processing_jobs", "project_index_configs", "#7c3aed", "target_index_config_id"),
    ("document_history", "documents", "#ea580c", "document_id"),
    ("analysis_jobs", "projects", "#16a34a", "project_id"),
    ("analysis_jobs", "documents", "#16a34a", "base_document_id"),
    ("analysis_job_targets", "analysis_jobs", "#15803d", "job_id"),
    ("analysis_job_targets", "documents", "#15803d", "document_id"),
]


def table_height(table: dict) -> int:
    return 82 + len(table["cols"]) * 42 + 18


def center(table: dict) -> tuple[int, int]:
    return table["x"] + table["w"] // 2, table["y"] + table_height(table) // 2


def edge_point(table: dict, toward: tuple[int, int]) -> tuple[int, int]:
    cx, cy = center(table)
    tx, ty = toward
    x, y, w, h = table["x"], table["y"], table["w"], table_height(table)
    dx, dy = tx - cx, ty - cy
    if abs(dx) / max(w, 1) > abs(dy) / max(h, 1):
        return (x + w if dx > 0 else x, cy)
    return (cx, y + h if dy > 0 else y)


def path_between(a: dict, b: dict) -> tuple[tuple[int, int], tuple[int, int], str]:
    ac = center(a)
    bc = center(b)
    start = edge_point(a, bc)
    end = edge_point(b, ac)
    if abs(start[0] - end[0]) > abs(start[1] - end[1]):
        mid = (start[0] + end[0]) // 2
        d = f"M {start[0]} {start[1]} C {mid} {start[1]}, {mid} {end[1]}, {end[0]} {end[1]}"
    else:
        mid = (start[1] + end[1]) // 2
        d = f"M {start[0]} {start[1]} C {start[0]} {mid}, {end[0]} {mid}, {end[0]} {end[1]}"
    return start, end, d


def text(x: int, y: int, value: str, cls: str, anchor: str = "start") -> str:
    return f'<text x="{x}" y="{y}" class="{cls}" text-anchor="{anchor}">{escape(value)}</text>'


def table_svg(name: str, table: dict) -> str:
    x, y, w = table["x"], table["y"], table["w"]
    h = table_height(table)
    accent = table["accent"]
    lines = [
        f'<g class="table" id="{table["schema"]}-{name}">',
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="18" class="card"/>',
        f'<rect x="{x}" y="{y}" width="{w}" height="82" rx="18" fill="{accent}"/>',
        f'<path d="M {x} {y + 62} H {x + w} V {y + 82} H {x} Z" fill="{accent}"/>',
        text(x + 28, y + 34, table["schema"], "schema"),
        text(x + 28, y + 66, name, "table-title"),
    ]
    row_y = y + 116
    for idx, (tag, col, typ) in enumerate(table["cols"]):
        if idx % 2 == 1:
            lines.append(f'<rect x="{x + 14}" y="{row_y - 29}" width="{w - 28}" height="38" rx="8" class="row-alt"/>')
        if tag:
            tag_cls = "tag pk" if "PK" in tag else "tag fk" if "FK" in tag else "tag ext"
            lines.append(f'<rect x="{x + 24}" y="{row_y - 25}" width="82" height="28" rx="8" class="{tag_cls}"/>')
            lines.append(text(x + 65, row_y - 5, tag, "tag-text", "middle"))
            col_x = x + 122
        else:
            col_x = x + 42
        lines.append(text(col_x, row_y, col, "col-name"))
        lines.append(text(x + w - 28, row_y, typ, "col-type", "end"))
        row_y += 42
    lines.append("</g>")
    return "\n".join(lines)


def external_box(x: int, y: int, w: int, h: int, title: str, body: str, accent: str) -> str:
    return "\n".join(
        [
            '<g>',
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="20" class="external"/>',
            f'<rect x="{x}" y="{y}" width="12" height="{h}" rx="6" fill="{accent}"/>',
            text(x + 34, y + 46, title, "external-title"),
            text(x + 34, y + 88, body, "external-body"),
            "</g>",
        ]
    )


def build_svg() -> str:
    svg: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        "<defs>",
        '<marker id="arrow" markerWidth="18" markerHeight="18" refX="15" refY="6" orient="auto" markerUnits="strokeWidth"><path d="M2,2 L15,6 L2,10 Z" fill="#334155"/></marker>',
        '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="#0f172a" flood-opacity="0.14"/></filter>',
        "<style>",
        """
        .bg { fill: #ffffff; }
        .band { fill: #f8fafc; stroke: #dbe3ef; stroke-width: 2; }
        .band-title { font: 700 34px Inter, Arial, sans-serif; fill: #334155; letter-spacing: .5px; }
        .title { font: 800 58px Inter, Arial, sans-serif; fill: #0f172a; }
        .subtitle { font: 400 28px Inter, Arial, sans-serif; fill: #475569; }
        .card { fill: #ffffff; stroke: #cbd5e1; stroke-width: 2.4; filter: url(#shadow); }
        .schema { font: 600 20px Inter, Arial, sans-serif; fill: rgba(255,255,255,.82); text-transform: uppercase; letter-spacing: 1.5px; }
        .table-title { font: 800 31px Inter, Arial, sans-serif; fill: #ffffff; }
        .row-alt { fill: #f8fafc; }
        .col-name { font: 600 24px Inter, Arial, sans-serif; fill: #111827; }
        .col-type { font: 500 22px Inter, Arial, sans-serif; fill: #64748b; }
        .tag { stroke-width: 1.5; }
        .pk { fill: #fef3c7; stroke: #d97706; }
        .fk { fill: #dbeafe; stroke: #2563eb; }
        .ext { fill: #dcfce7; stroke: #16a34a; }
        .tag-text { font: 800 15px Inter, Arial, sans-serif; fill: #1f2937; }
        .rel { fill: none; stroke-width: 4; stroke-linecap: round; marker-end: url(#arrow); opacity: .82; }
        .rel-label { font: 700 19px Inter, Arial, sans-serif; fill: #334155; paint-order: stroke; stroke: white; stroke-width: 6px; stroke-linejoin: round; }
        .external { fill: #fff7ed; stroke: #fed7aa; stroke-width: 2.4; filter: url(#shadow); }
        .external-title { font: 800 28px Inter, Arial, sans-serif; fill: #9a3412; }
        .external-body { font: 500 22px Inter, Arial, sans-serif; fill: #7c2d12; }
        .legend-title { font: 800 26px Inter, Arial, sans-serif; fill: #0f172a; }
        .legend { font: 500 22px Inter, Arial, sans-serif; fill: #475569; }
        """,
        "</style>",
        "</defs>",
        '<rect width="100%" height="100%" class="bg"/>',
        text(120, 105, "RAG System: PostgreSQL Data Model", "title"),
        text(120, 152, "Print-ready ERD from live Postgres: 8 application tables plus Alembic migration metadata.", "subtitle"),
        '<rect x="86" y="210" width="2055" height="2170" rx="32" class="band"/>',
        '<rect x="2180" y="210" width="1242" height="2170" rx="32" class="band"/>',
        text(130, 258, "documents schema", "band-title"),
        text(2225, 258, "analysis schema", "band-title"),
        text(2775, 1950, "public metadata", "band-title"),
    ]

    for src, dst, color, label in LINKS:
        a = TABLES[src]
        b = TABLES[dst]
        _, _, d = path_between(a, b)
        svg.append(f'<path d="{d}" class="rel" stroke="{color}"/>')

    svg.append(external_box(2010, 1115, 610, 165, "External file storage", "documents.storage_key", "#ea580c"))
    svg.append('<path d="M 1880 830 C 1990 900, 2010 1030, 2010 1190" class="rel" stroke="#ea580c"/>')
    svg.append(external_box(1960, 1970, 660, 165, "Qdrant vector store", "chunks.qdrant_point_id", "#0891b2"))
    svg.append('<path d="M 1880 1548 C 1990 1670, 1970 1880, 1960 2055" class="rel" stroke="#0891b2"/>')

    for name, table in TABLES.items():
        svg.append(table_svg(name, table))

    legend_x, legend_y = 120, 2298
    svg.append('<g>')
    svg.append(f'<rect x="{legend_x}" y="{legend_y - 54}" width="1110" height="92" rx="18" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>')
    svg.append(text(legend_x + 28, legend_y, "Legend", "legend-title"))
    for i, (tag, label, cls) in enumerate(
        [
            ("PK", "Primary key", "pk"),
            ("FK", "Foreign key", "fk"),
            ("UQ", "Unique", "pk"),
            ("EXT", "External store reference", "ext"),
        ]
    ):
        x = legend_x + 150 + i * 235
        svg.append(f'<rect x="{x}" y="{legend_y - 28}" width="74" height="30" rx="8" class="tag {cls}"/>')
        svg.append(text(x + 37, legend_y - 7, tag, "tag-text", "middle"))
        svg.append(text(x + 88, legend_y - 6, label, "legend"))
    svg.append("</g>")

    svg.append("</svg>")
    return "\n".join(svg)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    SVG_PATH.write_text(build_svg(), encoding="utf-8")
    print(SVG_PATH)


if __name__ == "__main__":
    main()
