ALTER TABLE storage_publish_workflows
  DROP CONSTRAINT storage_publish_workflows_document_id_fkey;
ALTER TABLE storage_publish_workflows
  ADD CONSTRAINT storage_publish_workflows_document_id_fkey
  FOREIGN KEY (document_id) REFERENCES library_entries(document_id) ON DELETE CASCADE;
