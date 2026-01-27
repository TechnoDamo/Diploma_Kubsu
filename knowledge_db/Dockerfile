# =============================================================================
# BASE IMAGE SELECTION
# =============================================================================
# Using PostgreSQL 15 Alpine for:
# - Small image size (~200MB vs ~600MB for debian)
# - Security-focused (minimal packages)
# - PostgreSQL 15 has excellent vector performance improvements
FROM postgres:15-alpine

# =============================================================================
# METADATA FOR BETTER IMAGE MANAGEMENT
# =============================================================================
LABEL maintainer="koblevdm"
LABEL description="PostgreSQL with pgvector extension for embedding storage"
LABEL version="1.0"
LABEL vector.version="0.5.1"

# =============================================================================
# INSTALLATION STAGE: BUILD DEPENDENCIES
# =============================================================================
# Alpine uses apk package manager
# Install ONLY what's needed for pgvector compilation
RUN apk add --no-cache --virtual .build-deps \
    git \
    build-base \
    postgresql-dev && \
    # Create directory for source code
    mkdir -p /tmp/build

# =============================================================================
# PGVECTOR INSTALLATION
# =============================================================================
# Clone specific version for reproducibility
RUN git clone --branch v0.5.1 --depth 1 \
    https://github.com/pgvector/pgvector.git /tmp/pgvector && \
    cd /tmp/pgvector && \
    # Compile the extension
    make && \
    # Install to PostgreSQL extensions directory
    make install && \
    # Clean up source code to reduce image size
    rm -rf /tmp/pgvector

# =============================================================================
# CLEANUP STAGE: REDUCE IMAGE SIZE
# =============================================================================
# Remove build dependencies (saves ~200MB)
RUN apk del .build-deps && \
    # Clean apk cache
    rm -rf /var/cache/apk/* && \
    # Verify pgvector files are installed
    find /usr/local/share/postgresql/extension -name "*vector*" -ls

# =============================================================================
# CUSTOM INITIALIZATION SCRIPTS
# =============================================================================
# Copy initialization script to PostgreSQL's auto-execution directory
# These run ONLY when database is first created (data directory is empty)
COPY init-vector-db.sh /docker-entrypoint-initdb.d/

# Set execution permissions for the script
RUN chmod +x /docker-entrypoint-initdb.d/init-vector-db.sh

# =============================================================================
# HEALTH CHECK CONFIGURATION
# =============================================================================
# Custom health check for vector database readiness
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD pg_isready -U $POSTGRES_USER -d $POSTGRES_DB || exit 1

# =============================================================================
# SECURITY: NON-PRIVILEGED USER
# =============================================================================
# Use the same non-root user as the base PostgreSQL image
USER postgres

# =============================================================================
# EXPOSE PORTS
# =============================================================================
# PostgreSQL default port - mapped externally in docker-compose
EXPOSE 5432

# =============================================================================
# CONTAINER ENTRYPOINT
# =============================================================================
# Inherits the base image's entrypoint which:
# 1. Initializes database if needed
# 2. Runs scripts in /docker-entrypoint-initdb.d/
# 3. Starts PostgreSQL server