#!/usr/bin/env bash
set -euo pipefail

kcadm=/opt/keycloak/bin/kcadm.sh
config_file=/tmp/liteasy-kcadm.config
rm -f "$config_file"
"$kcadm" config credentials \
  --config "$config_file" \
  --server http://127.0.0.1:8080 \
  --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" \
  --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"
echo "Keycloak bootstrap authentication completed."

uuid_pattern='^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'

client_id() {
  "$kcadm" get clients \
    --config "$config_file" \
    -r liteasy \
    -q "clientId=$1" \
    --fields id \
    --format csv \
    --noquotes
}

client_scope_id() {
  local requested_name="$1"
  local scope_id scope_name
  while IFS=, read -r scope_id scope_name; do
    if [[ "$scope_name" == "$requested_name" ]]; then
      printf '%s\n' "$scope_id"
      return 0
    fi
  done < <("$kcadm" get client-scopes \
    --config "$config_file" \
    -r liteasy \
    --fields id,name \
    --format csv \
    --noquotes)
  return 0
}

protocol_mapper_id() {
  local client_uuid="$1"
  local requested_name="$2"
  local mapper_id mapper_name
  while IFS=, read -r mapper_id mapper_name; do
    if [[ "$mapper_name" == "$requested_name" ]]; then
      printf '%s\n' "$mapper_id"
      return 0
    fi
  done < <("$kcadm" get "clients/$client_uuid/protocol-mappers/models" \
    --config "$config_file" \
    -r liteasy \
    --fields id,name \
    --format csv \
    --noquotes)
  return 0
}

identity_introspection_id=$(client_id liteasy-identity-introspection)
if [[ ! "$identity_introspection_id" =~ $uuid_pattern ]]; then
  "$kcadm" create clients \
    --config "$config_file" \
    -r liteasy \
    -s clientId=liteasy-identity-introspection \
    -s 'name=Liteasy identity-management token introspection' \
    -s enabled=true \
    -s publicClient=false \
    -s clientAuthenticatorType=client-secret \
    -s "secret=$LITEASY_IDENTITY_INTROSPECTION_CLIENT_SECRET" \
    -s standardFlowEnabled=false \
    -s directAccessGrantsEnabled=false \
    -s serviceAccountsEnabled=false \
    -s protocol=openid-connect >/dev/null
  identity_introspection_id=$(client_id liteasy-identity-introspection)
fi
if [[ ! "$identity_introspection_id" =~ $uuid_pattern ]]; then
  echo "Unable to configure the identity-management introspection client." >&2
  exit 1
fi

visualization_scope_id=$(client_scope_id visualization:generate)
if [[ ! "$visualization_scope_id" =~ $uuid_pattern ]]; then
  "$kcadm" create client-scopes \
    --config "$config_file" \
    -r liteasy \
    -s name=visualization:generate \
    -s protocol=openid-connect \
    -s 'attributes={"include.in.token.scope":"true","display.on.consent.screen":"false"}' >/dev/null
  visualization_scope_id=$(client_scope_id visualization:generate)
fi
if [[ ! "$visualization_scope_id" =~ $uuid_pattern ]]; then
  echo "Unable to configure the visualization:generate client scope." >&2
  exit 1
fi

visualization_client_id=$(client_id liteasy-visualization-service)
if [[ ! "$visualization_client_id" =~ $uuid_pattern ]]; then
  "$kcadm" create clients \
    --config "$config_file" \
    -r liteasy \
    -s clientId=liteasy-visualization-service \
    -s 'name=Liteasy visualization generation service' \
    -s enabled=true \
    -s publicClient=false \
    -s clientAuthenticatorType=client-secret \
    -s "secret=$LITEASY_VISUALIZATION_SERVICE_CLIENT_SECRET" \
    -s standardFlowEnabled=false \
    -s directAccessGrantsEnabled=false \
    -s serviceAccountsEnabled=true \
    -s 'defaultClientScopes=["visualization:generate"]' \
    -s protocol=openid-connect >/dev/null
  visualization_client_id=$(client_id liteasy-visualization-service)
fi
if [[ ! "$visualization_client_id" =~ $uuid_pattern ]]; then
  echo "Unable to configure the visualization service client." >&2
  exit 1
fi

"$kcadm" update "clients/$visualization_client_id" \
  --config "$config_file" \
  -r liteasy \
  -s 'defaultClientScopes=["visualization:generate"]' >/dev/null

visualization_mapper_id=$(protocol_mapper_id "$visualization_client_id" liteasy-visualization-audience)
if [[ ! "$visualization_mapper_id" =~ $uuid_pattern ]]; then
  "$kcadm" create "clients/$visualization_client_id/protocol-mappers/models" \
    --config "$config_file" \
    -r liteasy \
    -s name=liteasy-visualization-audience \
    -s protocol=openid-connect \
    -s protocolMapper=oidc-audience-mapper \
    -s consentRequired=false \
    -s 'config={"access.token.claim":"true","id.token.claim":"false","included.custom.audience":"liteasy-internal","introspection.token.claim":"true"}' >/dev/null
else
  "$kcadm" update "clients/$visualization_client_id/protocol-mappers/models/$visualization_mapper_id" \
    --config "$config_file" \
    -r liteasy \
    -s name=liteasy-visualization-audience \
    -s protocol=openid-connect \
    -s protocolMapper=oidc-audience-mapper \
    -s consentRequired=false \
    -s 'config={"access.token.claim":"true","id.token.claim":"false","included.custom.audience":"liteasy-internal","introspection.token.claim":"true"}' >/dev/null
fi

while IFS='|' read -r confidential_client secret_value; do
  confidential_client_id=$(client_id "$confidential_client")
  if [[ ! "$confidential_client_id" =~ $uuid_pattern ]]; then
    echo "Unable to resolve confidential client: $confidential_client" >&2
    exit 1
  fi
  "$kcadm" update "clients/$confidential_client_id" \
    --config "$config_file" \
    -r liteasy \
    -s enabled=true \
    -s publicClient=false \
    -s clientAuthenticatorType=client-secret \
    -s "secret=$secret_value" >/dev/null
done <<CLIENTS
liteasy-cloud|$LITEASY_CLOUD_CLIENT_SECRET
intuecho-api|$INTUECHO_API_CLIENT_SECRET
liteasy-account-lifecycle|$LITEASY_IDENTITY_MANAGEMENT_CLIENT_SECRET
liteasy-identity-introspection|$LITEASY_IDENTITY_INTROSPECTION_CLIENT_SECRET
intuecho-organization-service|$INTUECHO_ORGANIZATION_SERVICE_SECRET
liteasy-keycloak-admin|$LITEASY_IDENTITY_ADMIN_CLIENT_SECRET
liteasy-visualization-service|$LITEASY_VISUALIZATION_SERVICE_CLIENT_SECRET
CLIENTS

while IFS='|' read -r public_client redirect_uris web_origins logout_uris; do
  public_client_id=$(client_id "$public_client")
  if [[ ! "$public_client_id" =~ $uuid_pattern ]]; then
    echo "Unable to resolve public client: $public_client" >&2
    exit 1
  fi
  "$kcadm" update "clients/$public_client_id" \
    --config "$config_file" \
    -r liteasy \
    -s "redirectUris=$redirect_uris" \
    -s "webOrigins=$web_origins" \
    -s "attributes.\"post.logout.redirect.uris\"=$logout_uris" >/dev/null
done <<CLIENTS
liteasy-desktop-public|["$LITEASY_DESKTOP_LOOPBACK_REDIRECT_URI","$LITEASY_DESKTOP_LOCALHOST_REDIRECT_URI"]|["$LITEASY_DESKTOP_WEB_ORIGIN"]|$LITEASY_DESKTOP_LOOPBACK_REDIRECT_URI##$LITEASY_DESKTOP_LOCALHOST_REDIRECT_URI
intuecho-web|["$INTUECHO_WEB_LOOPBACK_REDIRECT_URI","$INTUECHO_WEB_REDIRECT_URI"]|["$INTUECHO_WEB_LOOPBACK_ORIGIN","$INTUECHO_WEB_ORIGIN"]|$INTUECHO_WEB_LOOPBACK_REDIRECT_URI##$INTUECHO_WEB_REDIRECT_URI
liteasy-admin-public|["$LITEASY_ADMIN_LOOPBACK_REDIRECT_URI","$LITEASY_ADMIN_REDIRECT_URI"]|["$LITEASY_ADMIN_LOOPBACK_ORIGIN","$LITEASY_ADMIN_WEB_ORIGIN"]|$LITEASY_ADMIN_LOOPBACK_REDIRECT_URI##$LITEASY_ADMIN_REDIRECT_URI
CLIENTS
echo "Keycloak confidential credentials, visualization scope, and public origins reconciled."

service_account_id=$("$kcadm" get users \
  --config "$config_file" \
  -r liteasy \
  -q username=service-account-liteasy-keycloak-admin \
  --fields id \
  --format csv \
  --noquotes)
realm_management_id=$("$kcadm" get clients \
  --config "$config_file" \
  -r liteasy \
  -q clientId=realm-management \
  --fields id \
  --format csv \
  --noquotes)
if [[ ! "$service_account_id" =~ $uuid_pattern || ! "$realm_management_id" =~ $uuid_pattern ]]; then
  echo "Unable to resolve Keycloak service-account role targets." >&2
  exit 1
fi
echo "Keycloak service-account role targets resolved."

for role in manage-users query-users view-users; do
  "$kcadm" add-roles \
    --config "$config_file" \
    -r liteasy \
    --uid "$service_account_id" \
    --cid "$realm_management_id" \
    --rolename "$role"
  echo "Keycloak role assigned: $role"
done
