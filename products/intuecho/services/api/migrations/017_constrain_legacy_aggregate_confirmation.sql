UPDATE literature_records AS record
SET identity_status = 'legacy_unverified',
    updated_at = now()
WHERE record.identity_status = 'confirmed'
  AND record.record_source = 'public_registry'
  AND record.source_provider IN ('openalex', 'semantic_scholar')
  AND NOT EXISTS (
    SELECT 1
      FROM literature_identity_claims AS claim
     WHERE claim.literature_id = record.id
       AND claim.provider IN ('crossref', 'arxiv')
       AND claim.verification_status = 'confirmed'
  )
  AND NOT EXISTS (
    SELECT 1
      FROM literature_identity_claims AS claim
     WHERE claim.literature_id = record.id
       AND claim.provider IN ('openalex', 'semantic_scholar')
       AND claim.verification_status = 'confirmed'
       AND (
         NULLIF(btrim(claim.evidence ->> 'candidateKey'), '') IS NOT NULL
         OR claim.evidence ->> 'confirmationBasis' IN (
           'user_selected_refetch',
           'independent_aggregate_bibliography'
         )
       )
  )
  AND 2 > (
    SELECT count(DISTINCT claim.provider)
      FROM literature_identity_claims AS claim
     WHERE claim.literature_id = record.id
       AND claim.provider IN ('openalex', 'semantic_scholar')
       AND claim.verification_status = 'confirmed'
  );
