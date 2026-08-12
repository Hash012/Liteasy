#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "install-runtime.sh must run as root" >&2
  exit 1
fi

umask 077
script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
node_image=node@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920
runtime_directory=/etc/liteasy/staging
scanner_directory=${runtime_directory}/pdf-scanner
tls_directory=${scanner_directory}/tls
ca_key=${scanner_directory}/ca.key
ca_certificate=${tls_directory}/ca.crt
server_key=${tls_directory}/server.key
server_certificate=${tls_directory}/server.crt
temporary_directory=$(mktemp -d /tmp/liteasy-scanner-pki.XXXXXX)

cleanup() {
  rm -rf -- "${temporary_directory}"
}
trap cleanup EXIT HUP INT TERM

test -f "${runtime_directory}/liteasy-api.env"
test -f "${runtime_directory}/aliyun-rds-ca.pem"
install -d -m 0700 -o root -g root "${scanner_directory}"
install -d -m 0750 -o root -g 1000 "${tls_directory}"

if [ -e "${ca_key}" ] || [ -e "${ca_certificate}" ]; then
  test -f "${ca_key}"
  test -f "${ca_certificate}"
else
  openssl genpkey \
    -algorithm RSA \
    -pkeyopt rsa_keygen_bits:3072 \
    -out "${temporary_directory}/ca.key"
  openssl req \
    -x509 \
    -new \
    -sha256 \
    -days 3650 \
    -key "${temporary_directory}/ca.key" \
    -subj "/O=Liteasy Staging/CN=Liteasy Staging Internal Scanner CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    -out "${temporary_directory}/ca.crt"
  install -m 0600 -o root -g root "${temporary_directory}/ca.key" "${ca_key}"
  install -m 0644 -o root -g root "${temporary_directory}/ca.crt" "${ca_certificate}"
fi

if [ ! -f "${server_key}" ] || [ ! -f "${server_certificate}" ] || \
   ! openssl x509 -checkend 2592000 -noout -in "${server_certificate}" >/dev/null 2>&1; then
  openssl genpkey \
    -algorithm RSA \
    -pkeyopt rsa_keygen_bits:2048 \
    -out "${temporary_directory}/server.key"
  openssl req \
    -new \
    -sha256 \
    -key "${temporary_directory}/server.key" \
    -config "${script_directory}/scanner-cert.cnf" \
    -out "${temporary_directory}/server.csr"
  openssl x509 \
    -req \
    -sha256 \
    -days 397 \
    -in "${temporary_directory}/server.csr" \
    -CA "${ca_certificate}" \
    -CAkey "${ca_key}" \
    -CAcreateserial \
    -CAserial "${temporary_directory}/ca.srl" \
    -extfile "${script_directory}/scanner-cert.cnf" \
    -extensions server_ext \
    -out "${temporary_directory}/server.crt"
  install -m 0440 -o root -g 1000 "${temporary_directory}/server.key" "${server_key}"
  install -m 0644 -o root -g root "${temporary_directory}/server.crt" "${server_certificate}"
fi

openssl pkey -in "${ca_key}" -noout -check >/dev/null
openssl verify -CAfile "${ca_certificate}" "${server_certificate}" >/dev/null
openssl x509 -checkhost pdf-scanner -noout -in "${server_certificate}" >/dev/null
docker run --rm \
  --network none \
  --read-only \
  --user 0:0 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --mount "type=bind,src=${runtime_directory},dst=/runtime" \
  --mount "type=bind,src=${script_directory}/configure-runtime.mjs,dst=/tool/configure-runtime.mjs,readonly" \
  "${node_image}" \
  node /tool/configure-runtime.mjs /runtime

chown root:root \
  "${runtime_directory}/aliyun-rds-ca.pem" \
  "${runtime_directory}/liteasy-api-ca.pem" \
  "${runtime_directory}/liteasy-api.env" \
  "${runtime_directory}/pdf-scanner.env"
chmod 0644 "${runtime_directory}/aliyun-rds-ca.pem" "${runtime_directory}/liteasy-api-ca.pem"
chmod 0600 "${runtime_directory}/liteasy-api.env" "${runtime_directory}/pdf-scanner.env"

echo "Scanner runtime configuration installed."
