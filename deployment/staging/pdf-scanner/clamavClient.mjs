import { createHash } from "node:crypto";
import net from "node:net";

const maximumClamdResponseBytes = 4096;

export class ClamAvError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function failure(code) {
  return new ClamAvError(code);
}

function responseReader(socket) {
  let settled = false;
  let byteLength = 0;
  const chunks = [];
  const promise = new Promise((resolve, reject) => {
    socket.on("data", (chunk) => {
      if (settled) return;
      const terminator = chunk.indexOf(0);
      const bytes = terminator < 0 ? chunk : chunk.subarray(0, terminator);
      byteLength += bytes.length;
      if (byteLength > maximumClamdResponseBytes) {
        settled = true;
        reject(failure("clamav_response_too_large"));
        socket.destroy();
        return;
      }
      chunks.push(bytes);
      if (terminator >= 0) {
        settled = true;
        resolve(Buffer.concat(chunks).toString("utf8").trim());
      }
    });
    socket.once("error", () => {
      if (!settled) {
        settled = true;
        reject(failure("clamav_connection_failed"));
      }
    });
    socket.once("close", () => {
      if (!settled) {
        settled = true;
        reject(failure("clamav_response_incomplete"));
      }
    });
  });
  promise.catch(() => {});
  return promise;
}

function connect({ host, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const onError = () => reject(failure("clamav_connection_failed"));
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      socket.setNoDelay(true);
      socket.setTimeout(timeoutMs, () => {
        socket.destroy(failure("clamav_timeout"));
      });
      resolve(socket);
    });
  });
}

function write(socket, bytes) {
  return new Promise((resolve, reject) => {
    socket.write(bytes, (error) => error ? reject(failure("clamav_write_failed")) : resolve());
  });
}

function parseVersion(response) {
  const match = /^ClamAV ([A-Za-z0-9.+-]+)\/([0-9]+)(?:\/|$)/.exec(response);
  if (!match) throw failure("clamav_version_invalid");
  return `${match[1]}/${match[2]}`;
}

export class ClamAvClient {
  constructor({ host, port = 3310, timeoutMs = 110_000 }) {
    if (typeof host !== "string" || !/^[a-z0-9][a-z0-9.-]{0,252}$/i.test(host)) {
      throw new TypeError("clamav_host_invalid");
    }
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new TypeError("clamav_port_invalid");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
      throw new TypeError("clamav_timeout_invalid");
    }
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.versionCache = undefined;
  }

  async command(command) {
    const socket = await connect(this);
    const response = responseReader(socket);
    try {
      await write(socket, Buffer.from(`z${command}\0`, "ascii"));
      return await response;
    } finally {
      socket.destroy();
    }
  }

  async ping() {
    if (await this.command("PING") !== "PONG") throw failure("clamav_ping_invalid");
    return true;
  }

  async version({ refresh = false } = {}) {
    const now = Date.now();
    if (!refresh && this.versionCache?.expiresAt > now) return this.versionCache.value;
    const value = parseVersion(await this.command("VERSION"));
    this.versionCache = { expiresAt: now + 60_000, value };
    return value;
  }

  async info() {
    await this.ping();
    return { scanner: "clamav", version: await this.version({ refresh: true }) };
  }

  async scan(readable, { expectedLength, maximumBytes }) {
    if (!readable || typeof readable[Symbol.asyncIterator] !== "function") {
      throw new TypeError("clamav_stream_invalid");
    }
    if (!Number.isSafeInteger(expectedLength) || expectedLength < 1 ||
      !Number.isSafeInteger(maximumBytes) || expectedLength > maximumBytes) {
      throw new TypeError("clamav_length_invalid");
    }

    const hash = createHash("sha256");
    const socket = await connect(this);
    const response = responseReader(socket);
    let byteLength = 0;
    try {
      await write(socket, Buffer.from("zINSTREAM\0", "ascii"));
      for await (const chunk of readable) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (bytes.length === 0) continue;
        byteLength += bytes.length;
        if (byteLength > expectedLength || byteLength > maximumBytes) {
          throw failure("scanner_request_length_mismatch");
        }
        hash.update(bytes);
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(bytes.length);
        await write(socket, length);
        await write(socket, bytes);
      }
      if (byteLength !== expectedLength) throw failure("scanner_request_length_mismatch");
      await write(socket, Buffer.alloc(4));

      const verdict = await response;
      let clean;
      if (/^[^:]+: OK$/.test(verdict)) clean = true;
      else if (/^[^:]+: .+ FOUND$/.test(verdict)) clean = false;
      else throw failure("clamav_scan_failed");

      return {
        byteLength,
        clean,
        contentHash: hash.digest("hex"),
        scanner: "clamav",
        version: await this.version()
      };
    } finally {
      socket.destroy();
    }
  }
}

export { maximumClamdResponseBytes };
