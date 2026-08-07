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
echo "Keycloak confidential credentials and public origins reconciled."

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
