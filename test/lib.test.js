import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { X509Certificate } from "node:crypto";
import {
  isFQDN,
  sanitizeInput,
  readUrl,
  hostIsUp,
  resolveIP,
  buildClientHello,
  extractLeafCert,
  dnField,
} from "../src/lib.js";

// Real TLS 1.2 ServerHello..Certificate flight captured from example.com:443
const fixture = readFileSync(
  new URL("./fixtures/tls12-handshake-example-com.bin", import.meta.url)
);

test("extractLeafCert parses a real TLS 1.2 handshake and returns the leaf cert", () => {
  const der = extractLeafCert(fixture);
  assert.ok(Buffer.isBuffer(der) && der.length > 500);
  const cert = new X509Certificate(der);
  assert.match(cert.subjectAltName, /DNS:example\.com/);
  assert.ok(new Date(cert.validTo) > new Date());
});

test("extractLeafCert returns null on a truncated buffer", () => {
  assert.equal(extractLeafCert(fixture.subarray(0, 40)), null);
  assert.equal(extractLeafCert(Buffer.alloc(0)), null);
});

test("extractLeafCert throws on a TLS alert record", () => {
  // record: type 21 (alert), TLS 1.2, len 2, fatal handshake_failure
  const alert = Buffer.from([0x15, 0x03, 0x03, 0x00, 0x02, 0x02, 0x28]);
  assert.throws(() => extractLeafCert(alert), /alert/);
});

test("extractLeafCert throws when the server negotiates TLS 1.3", () => {
  // record: type 22, handshake type 2 (ServerHello), server version 0x0304
  const sh13 = Buffer.from([
    0x16, 0x03, 0x03, 0x00, 0x06, // record header, len 6
    0x02, 0x00, 0x00, 0x02, // ServerHello, body len 2
    0x03, 0x04, // <- TLS 1.3
  ]);
  assert.throws(() => extractLeafCert(sh13), /TLS 1\.3/);
});

test("buildClientHello produces a well-formed TLS 1.2 ClientHello with SNI", () => {
  const hello = buildClientHello("example.com");
  assert.equal(hello[0], 0x16); // handshake record
  assert.equal(hello[1], 0x03);
  assert.equal(hello[5], 0x01); // ClientHello
  assert.equal(hello[9], 0x03);
  assert.equal(hello[10], 0x03); // legacy version TLS 1.2
  assert.ok(hello.includes(Buffer.from("example.com", "ascii"))); // SNI present
  assert.equal(hello.readUInt16BE(3), hello.length - 5); // record length matches
});

test("sanitizeInput extracts host from URLs and bare hosts", () => {
  assert.equal(sanitizeInput("https://www.example.com/path?q=1"), "example.com");
  assert.equal(sanitizeInput("http://user:pass@example.com/"), "example.com");
  assert.equal(sanitizeInput("http://user:pass@example.com:8080/"), null);
  assert.equal(sanitizeInput("example.com"), "example.com");
  assert.equal(sanitizeInput("1.1.1.1"), "1.1.1.1");
  assert.equal(sanitizeInput("http://user:pass@example.com/"), "example.com");
  // empty/whitespace-only input is rejected; other junk just fails to resolve later
  assert.equal(sanitizeInput(""), null);
  assert.equal(sanitizeInput("   "), null);
  // host:port is rejected instead of silently dropping the port
  assert.equal(sanitizeInput("example.com:8080"), null);
  assert.equal(sanitizeInput("http://example.com:8080/"), null);
  assert.equal(sanitizeInput("1.1.1.1:80"), null);
});

test("isFQDN accepts FQDNs incl. long TLDs, rejects IPs, URLs, garbage", () => {
  assert.equal(isFQDN("example.com"), "example.com");
  assert.equal(isFQDN("sub.example.co.uk"), "sub.example.co.uk");
  assert.equal(isFQDN("example.technology"), "example.technology");
  assert.equal(isFQDN("example.international"), "example.international");
  assert.equal(isFQDN("1.1.1.1"), null);
  assert.equal(isFQDN("https://example.com"), null);
  assert.equal(isFQDN("example.com:8080"), null);
  assert.equal(isFQDN("not a fqdn!!"), null);
  assert.equal(isFQDN(""), null);
});

test("readUrl validates the request body", async () => {
  const mk = (body, headers = {}) =>
    new Request("http://localhost/ping", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  assert.deepEqual(await readUrl(mk(JSON.stringify({}))), {
    error: "No URL / IP provided",
  });
  assert.deepEqual(await readUrl(mk(JSON.stringify({ url: 123 }))), {
    error: "No URL / IP provided",
  });
  assert.deepEqual(await readUrl(mk("not json at all")), {
    error: "No URL / IP provided",
  });
  assert.deepEqual(await readUrl(mk(JSON.stringify({ url: "example.com:8080" }))), {
    error: "Invalid URL / IP",
  });
  assert.deepEqual(await readUrl(mk(JSON.stringify({ url: "https://example.com/x" }))), {
    url: "example.com",
  });
  // oversized declared body -> 413
  const big = await readUrl({
    headers: new Headers({ "content-length": "200000" }),
    json: async () => ({}),
  });
  assert.equal(big.status, 413);
  // oversized url string (no content-length needed) -> 413
  const longUrl = await readUrl(mk(JSON.stringify({ url: "a".repeat(3000) })));
  assert.equal(longUrl.status, 413);
});

test("hostIsUp is true for a responding host, false for a closed port", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    assert.equal(await hostIsUp(`127.0.0.1:${port}`, 2000), true);
    assert.equal(await hostIsUp("127.0.0.1:1", 500), false);
  } finally {
    server.close();
  }
});

test("resolveIP returns IP literals unchanged without any lookup", async () => {
  assert.equal(await resolveIP("1.1.1.1"), "1.1.1.1");
});

test("dnField extracts CN/O from multi-line and comma DNs", () => {
  assert.equal(dnField("CN=example.com\nO=Org", "CN"), "example.com");
  assert.equal(dnField("C=US,O=SSL Corporation,CN=CA", "O"), "SSL Corporation");
  assert.equal(dnField("CN=*.badssl.com", "CN"), "*.badssl.com");
});
