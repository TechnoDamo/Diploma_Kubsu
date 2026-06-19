"""drop general_context from documents.projects

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("projects", "general_context", schema="documents")


def downgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("general_context", sa.Text(), server_default="", nullable=False),
        schema="documents",
    )
