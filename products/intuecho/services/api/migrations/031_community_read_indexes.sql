CREATE INDEX annotations_public_page_idx ON annotations(created_at DESC, id DESC) WHERE share_to_plaza AND visibility = 'public' AND withdrawn_at IS NULL;
CREATE INDEX literature_identifiers_exact_lookup_idx ON literature_identifiers(identifier_kind, normalized_value, literature_id);
