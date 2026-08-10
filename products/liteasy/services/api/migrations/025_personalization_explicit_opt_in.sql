ALTER TABLE personalization_states
  ALTER COLUMN enabled SET DEFAULT false;

WITH disabled AS (
  UPDATE personalization_states
     SET enabled = false,
         version = version + 1,
         updated_at = now()
   WHERE enabled = true
   RETURNING subject_id
)
DELETE FROM recommendation_cache_entries cache
 USING disabled
 WHERE cache.subject_id = disabled.subject_id;
