import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { createIdentityManagementHandler } from "./app.mjs";

function request(url, authorization = "Bearer service-token") {
  const stream = Readable.from([]);
  stream.method = "GET";
  stream.url = url;
  stream.headers = { authorization };
  return stream;
}

function response() {
  const result = new Writable({
    write(chunk, _encoding, callback) {
      this.body = Buffer.concat([this.body, Buffer.from(chunk)]);
      callback();
    }
  });
  result.body = Buffer.alloc(0);
  result.writeHead = function writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  };
  return result;
}

test("authorizes and validates a bounded account directory request", async () => {
  const calls = [];
  const handler = createIdentityManagementHandler({ authorization: {} }, {
    async listAccounts(input) {
      calls.push(input);
      return { accounts: [], ...input, total: 0 };
    }
  }, {
    async authorize(header) { calls.push(header); }
  });
  const result = response();
  await handler(request("/v1/accounts?first=50&max=25&search=reader%40example.com"), result);
  assert.equal(result.status, 200);
  assert.deepEqual(calls, ["Bearer service-token", { first: 50, max: 25, search: "reader@example.com" }]);
  assert.equal(result.headers["cache-control"], "no-store");
});

test("rejects unknown, unbounded, and malformed account directory queries", async () => {
  const handler = createIdentityManagementHandler({ authorization: {} }, {
    async listAccounts() { throw new Error("must not run"); }
  }, { async authorize() {} });
  for (const url of [
    "/v1/accounts?max=101",
    "/v1/accounts?first=-1",
    "/v1/accounts?first=0&first=50",
    "/v1/accounts?unknown=true",
    `/v1/accounts?search=${"a".repeat(101)}`
  ]) {
    const result = response();
    await handler(request(url), result);
    assert.equal(result.status, 400, url);
    assert.equal(JSON.parse(result.body).code, "account_directory_query_invalid");
  }
});
