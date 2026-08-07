# Liteasy identity-management adapter

This service is the narrow adapter between Liteasy's account-lifecycle protocol
and Keycloak Admin REST. It does not create accounts and does not store passwords.

`POST /v1/accounts/:subjectId/status` accepts only a token issued to the dedicated
`liteasy-account-lifecycle` caller with audience `liteasy-identity-management` and
both `accounts:write` and `sessions:revoke` scopes. A separate confidential client
authenticates RFC 7662 introspection, and another confidential client holds
Keycloak's least-privilege user-management role. Caller, verifier, and administrator
credentials cannot be shared. Authorization also requires the configured issuer.

For `disabled` and `deleted`, the adapter invokes Keycloak's all-session logout
before returning the exact three Liteasy product audiences. A repeated delete is a
desired-state operation: an already absent Keycloak subject is returned as deleted.
Liteasy Cloud still owns the durable cross-service stage ledger and idempotency key.

Run tests with:

```bash
npm test
```

The local foundation in `deploy/local` supplies generated development secrets and
the matching realm clients. Staging and production must use HTTPS, a secret manager,
network isolation, Keycloak audit events, and deployment-specific client roles.
