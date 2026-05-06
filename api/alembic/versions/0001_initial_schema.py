"""initial schema

Revision ID: 0001
Revises:
Create Date: 2025-05-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS documents")
    op.execute("CREATE SCHEMA IF NOT EXISTS analysis")

    op.create_table(
        "projects",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("general_context", sa.Text(), server_default="", nullable=False),
        sa.Column("state", sa.Text(), server_default="active", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        schema="documents",
    )

    op.create_table(
        "project_index_configs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("project_id", sa.BigInteger(), sa.ForeignKey("documents.projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("embedding_model_name", sa.Text(), nullable=False),
        sa.Column("embedding_dimension", sa.Integer(), nullable=False),
        sa.Column("parser_name", sa.Text(), server_default="docling", nullable=False),
        sa.Column("parser_version", sa.Text(), nullable=True),
        sa.Column("chunking_strategy", sa.Text(), server_default="recursive", nullable=False),
        sa.Column("chunk_size", sa.Integer(), server_default="1200", nullable=False),
        sa.Column("chunk_overlap", sa.Integer(), server_default="200", nullable=False),
        sa.Column("chunk_unit", sa.Text(), server_default="characters", nullable=False),
        sa.Column("tokenizer_name", sa.Text(), nullable=True),
        sa.Column("rag_dense_weight", sa.Float(), server_default="0.7", nullable=False),
        sa.Column("rag_sparse_weight", sa.Float(), server_default="0.3", nullable=False),
        sa.Column("rag_top_k", sa.Integer(), nullable=True),
        sa.Column("rag_context_top_n", sa.Integer(), nullable=True),
        sa.Column("query_rewrite_enabled", sa.Boolean(), nullable=True),
        sa.Column("contradiction_dense_weight", sa.Float(), server_default="0.5", nullable=False),
        sa.Column("contradiction_sparse_weight", sa.Float(), server_default="0.5", nullable=False),
        sa.Column("contradiction_top_k", sa.Integer(), nullable=True),
        sa.Column("contradiction_max_distance", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "version"),
        schema="documents",
    )

    op.create_index(
        "idx_project_index_configs_one_active_per_project",
        "project_index_configs",
        ["project_id"],
        unique=False,
        schema="documents",
        postgresql_where=sa.text("is_active"),
    )
    op.create_index(
        "idx_project_index_configs_project_id",
        "project_index_configs",
        ["project_id"],
        unique=False,
        schema="documents",
    )

    op.create_table(
        "documents",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("project_id", sa.BigInteger(), sa.ForeignKey("documents.projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("mime_type", sa.Text(), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default="uploaded", nullable=False),
        sa.Column("indexed_config_id", sa.BigInteger(), sa.ForeignKey("documents.project_index_configs.id"), nullable=True),
        sa.Column("summary", sa.Text(), server_default="", nullable=False),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema="documents",
    )

    op.create_index("idx_documents_project_id_status", "documents", ["project_id", "status"], unique=False, schema="documents")
    op.create_index("idx_documents_project_id", "documents", ["project_id"], unique=False, schema="documents")

    op.create_table(
        "chunks",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("document_id", sa.BigInteger(), sa.ForeignKey("documents.documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.BigInteger(), sa.ForeignKey("documents.projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("index_config_id", sa.BigInteger(), sa.ForeignKey("documents.project_index_configs.id"), nullable=False),
        sa.Column("qdrant_point_id", sa.Uuid(), nullable=False),
        sa.Column("chunk_order", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("char_start", sa.Integer(), nullable=False),
        sa.Column("char_end", sa.Integer(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=True),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "chunk_order"),
        schema="documents",
    )

    op.create_index("idx_chunks_project_id", "chunks", ["project_id"], unique=False, schema="documents")
    op.create_index("idx_chunks_document_id", "chunks", ["document_id"], unique=False, schema="documents")

    op.create_table(
        "document_processing_jobs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("project_id", sa.BigInteger(), sa.ForeignKey("documents.projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("document_id", sa.BigInteger(), sa.ForeignKey("documents.documents.id", ondelete="CASCADE"), nullable=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default="queued", nullable=False),
        sa.Column("target_index_config_id", sa.BigInteger(), sa.ForeignKey("documents.project_index_configs.id"), nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("claimed_by", sa.Text(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="documents",
    )

    op.create_index("idx_document_processing_jobs_status", "document_processing_jobs", ["status"], unique=False, schema="documents")

    op.create_table(
        "document_history",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("document_id", sa.BigInteger(), sa.ForeignKey("documents.documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("operation", sa.Text(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema="documents",
    )

    op.create_table(
        "analysis_jobs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("project_id", sa.BigInteger(), sa.ForeignKey("documents.projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("base_document_id", sa.BigInteger(), sa.ForeignKey("documents.documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.Text(), server_default="queued", nullable=False),
        sa.Column("warning_message", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("results", sa.JSON(), nullable=True),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("claimed_by", sa.Text(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="analysis",
    )

    op.create_index("idx_analysis_jobs_project_id_status", "analysis_jobs", ["project_id", "status"], unique=False, schema="analysis")

    op.create_table(
        "analysis_job_targets",
        sa.Column("job_id", sa.BigInteger(), sa.ForeignKey("analysis.analysis_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("document_id", sa.BigInteger(), sa.ForeignKey("documents.documents.id", ondelete="CASCADE"), nullable=False),
        sa.PrimaryKeyConstraint("job_id", "document_id"),
        schema="analysis",
    )

    op.execute("""
        CREATE OR REPLACE FUNCTION documents.set_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    op.execute("""
        CREATE TRIGGER trg_projects_set_updated_at
            BEFORE UPDATE ON documents.projects
            FOR EACH ROW EXECUTE FUNCTION documents.set_updated_at();
    """)
    op.execute("""
        CREATE TRIGGER trg_documents_set_updated_at
            BEFORE UPDATE ON documents.documents
            FOR EACH ROW EXECUTE FUNCTION documents.set_updated_at();
    """)
    op.execute("""
        CREATE TRIGGER trg_document_processing_jobs_set_updated_at
            BEFORE UPDATE ON documents.document_processing_jobs
            FOR EACH ROW EXECUTE FUNCTION documents.set_updated_at();
    """)
    op.execute("""
        CREATE TRIGGER trg_analysis_jobs_set_updated_at
            BEFORE UPDATE ON analysis.analysis_jobs
            FOR EACH ROW EXECUTE FUNCTION documents.set_updated_at();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_analysis_jobs_set_updated_at ON analysis.analysis_jobs")
    op.execute("DROP TRIGGER IF EXISTS trg_document_processing_jobs_set_updated_at ON documents.document_processing_jobs")
    op.execute("DROP TRIGGER IF EXISTS trg_documents_set_updated_at ON documents.documents")
    op.execute("DROP TRIGGER IF EXISTS trg_projects_set_updated_at ON documents.projects")
    op.execute("DROP FUNCTION IF EXISTS documents.set_updated_at()")

    op.drop_table("analysis_job_targets", schema="analysis")
    op.drop_table("analysis_jobs", schema="analysis")
    op.drop_table("document_history", schema="documents")
    op.drop_table("document_processing_jobs", schema="documents")
    op.drop_table("chunks", schema="documents")
    op.drop_table("documents", schema="documents")
    op.drop_table("project_index_configs", schema="documents")
    op.drop_table("projects", schema="documents")
    op.execute("DROP SCHEMA IF EXISTS analysis")
    op.execute("DROP SCHEMA IF EXISTS documents")
