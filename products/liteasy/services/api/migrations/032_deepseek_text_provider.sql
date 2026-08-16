UPDATE platform_model_policies
   SET default_provider = 'deepseek',
       revision = revision + 1,
       updated_by = 'migration:032_deepseek_text_provider',
       updated_at = now()
 WHERE policy_id = 'active'
   AND default_provider <> 'deepseek';

INSERT INTO visualization_cost_policies(
  modality, operation, data_class, provider_id, unit_cost, revision,
  enabled, updated_by, reason, created_at, updated_at
)
SELECT cost.modality, cost.operation, cost.data_class, 'deepseek', cost.unit_cost, cost.revision,
       cost.enabled, 'migration:032_deepseek_text_provider',
       'Preserve versioned cost policy while routing structured generation to DeepSeek',
       cost.created_at, now()
  FROM visualization_cost_policies AS cost
  JOIN visualization_provider_configs AS route
    ON route.route_id = 'platform-openai-structured'
   AND route.provider_id = cost.provider_id
ON CONFLICT (modality, operation, data_class, provider_id, revision) DO NOTHING;

UPDATE visualization_provider_configs
   SET provider_id = 'deepseek',
       endpoint = 'https://api.deepseek.com/chat/completions',
       model = 'deepseek-chat',
       secret_ref = 'viz-secret:platform-deepseek',
       revision = revision + 1,
       updated_by = 'migration:032_deepseek_text_provider',
       updated_at = now()
 WHERE route_id = 'platform-openai-structured'
   AND (
     provider_id <> 'deepseek' OR
     endpoint <> 'https://api.deepseek.com/chat/completions' OR
     model <> 'deepseek-chat' OR
     secret_ref <> 'viz-secret:platform-deepseek'
   );
