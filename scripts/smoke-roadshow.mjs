const baseUrl = process.argv[2];

if (!baseUrl) {
  console.error("Usage: node scripts/smoke-roadshow.mjs <base-url>");
  process.exit(1);
}

const checks = [
  { expectJson: true, path: "/" },
  { expectJson: true, path: "/healthz" },
  { expectText: "Liteasy Operations Console", path: "/admin/" },
  { expectJson: true, path: "/v1/admin/demo-state" }
];

for (const check of checks) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${check.path}`);

  if (!response.ok) {
    console.error(`FAIL ${check.path}: ${response.status}`);
    process.exit(1);
  }

  if (check.expectJson) {
    await response.json();
  }

  if (check.expectText) {
    const text = await response.text();
    if (!text.includes(check.expectText)) {
      console.error(`FAIL ${check.path}: missing text "${check.expectText}"`);
      process.exit(1);
    }
  }

  console.log(`PASS ${check.path}`);
}
