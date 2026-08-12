# Liteasy staging PDF scanner

This deployment runs a private HTTPS adapter in front of ClamAV. It streams each
PDF to `clamd`, verifies the declared byte length and SHA-256, and returns the
strict response consumed by Liteasy API. A scanner outage fails closed.

The containers do not publish host ports. `clamd` only joins the internal scanner
network, `freshclam` alone has update egress, and the HTTPS adapter additionally
joins `liteasy-staging_backend` so Liteasy API can reach it.

From the repository root, after the main staging Compose project has created its
backend network:

```bash
sudo deployment/staging/pdf-scanner/install-runtime.sh
sudo docker compose \
  --project-directory deployment/staging/pdf-scanner \
  --file deployment/staging/pdf-scanner/compose.yaml \
  up --detach --build --wait clamav freshclam pdf-scanner
sudo docker compose \
  --project-directory deployment/staging/pdf-scanner \
  --file deployment/staging/pdf-scanner/compose.yaml \
  --profile acceptance run --rm --no-deps scanner-verifier
```

To prove fail-closed behavior, stop only `clamav`, run the verifier in unavailable
mode, then restore it and repeat the full check:

```bash
sudo docker compose \
  --project-directory deployment/staging/pdf-scanner \
  --file deployment/staging/pdf-scanner/compose.yaml \
  stop clamav
sudo docker compose \
  --project-directory deployment/staging/pdf-scanner \
  --file deployment/staging/pdf-scanner/compose.yaml \
  --profile acceptance run --rm --no-deps scanner-verifier unavailable
sudo docker compose \
  --project-directory deployment/staging/pdf-scanner \
  --file deployment/staging/pdf-scanner/compose.yaml \
  up --detach --wait clamav pdf-scanner
```

Never print or commit `/etc/liteasy/staging/pdf-scanner.env`, the internal CA key,
or the TLS server key. The installer preserves existing secret and CA material on
repeat runs and only renews a missing or nearly expired server certificate.
