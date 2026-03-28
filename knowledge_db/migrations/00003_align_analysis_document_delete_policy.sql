-- +goose Up
ALTER TABLE analysis.analysis_job_targets
    DROP CONSTRAINT IF EXISTS analysis_job_targets_document_id_fkey;

ALTER TABLE analysis.analysis_job_targets
    ADD CONSTRAINT analysis_job_targets_document_id_fkey
    FOREIGN KEY (document_id)
    REFERENCES documents.documents(id)
    ON DELETE CASCADE;

ALTER TABLE analysis.analysis_jobs
    DROP CONSTRAINT IF EXISTS analysis_jobs_base_document_id_fkey;

ALTER TABLE analysis.analysis_jobs
    ADD CONSTRAINT analysis_jobs_base_document_id_fkey
    FOREIGN KEY (base_document_id)
    REFERENCES documents.documents(id)
    ON DELETE CASCADE;

-- +goose Down
ALTER TABLE analysis.analysis_jobs
    DROP CONSTRAINT IF EXISTS analysis_jobs_base_document_id_fkey;

ALTER TABLE analysis.analysis_jobs
    ADD CONSTRAINT analysis_jobs_base_document_id_fkey
    FOREIGN KEY (base_document_id)
    REFERENCES documents.documents(id);

ALTER TABLE analysis.analysis_job_targets
    DROP CONSTRAINT IF EXISTS analysis_job_targets_document_id_fkey;

ALTER TABLE analysis.analysis_job_targets
    ADD CONSTRAINT analysis_job_targets_document_id_fkey
    FOREIGN KEY (document_id)
    REFERENCES documents.documents(id);
