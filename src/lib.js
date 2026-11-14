// Pure helpers, no runtime imports, so they can be unit-tested with node --test.

export const isFQDN = function (input) {
  const fqdnRegex =
    /^(?!:\/\/)(?:(?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,63}$/;
  return fqdnRegex.test(input) ? input : null;
};

export const sanitizeInput = function (url) {
  const urlRegex =
    /^((https?|ftp):\/\/)?([^\s/$.?#].[^\s]*)|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/i;
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!url.match(urlRegex) && !url.match(ipRegex)) {
    return null;
  }

  // host:port is not supported (checks always use port 80/443) — reject it
  // instead of silently dropping the port
  const authority = url.replace(/^\w+:\/\//, "").split("/")[0].split("@").pop();
  if (authority.includes(":")) return null;

  const regex = /^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?]+)/;
  const match = url.match(regex);

  if (match) {
    return match[1];
  } else {
    return url.replace(/(^\w+:|^)\/\//, "");
  }
};

// Shared input handling for both POST endpoints: body-size guard, JSON parse,
// type/length checks, sanitize. Returns { url } or { error, status? }.
// Takes anything request-like ({ headers, json() }) so it is unit-testable.
export async function readUrl(request) {
  if (Number(request.headers.get("content-length")) > 100_000)
    return { error: "Payload too large", status: 413 };
  const body = await request.json().catch(() => ({}));
  const raw = typeof body.url === "string" ? body.url : "";
  if (raw === "") return { error: "No URL / IP provided" };
  if (raw.length > 2048) return { error: "URL too long", status: 413 };
  const url = sanitizeInput(raw);
  if (!url) return { error: "Invalid URL / IP" };
  return { url };
}

// --- Minimal TLS 1.2 client handshake --------------------------------------
// Workers cannot read the peer certificate of an outbound connection
// (node:tls getPeerCertificate is not implemented in workerd), so we send a
// minimal TLS 1.2 ClientHello over a raw socket: in TLS 1.2 the Certificate
// message is sent in plaintext and can be extracted and parsed.

function u16(n) {
  return Buffer.from([(n >> 8) & 0xff, n & 0xff]);
}
function u24(n) {
  return Buffer.from([(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}

export function buildClientHello(host) {
  const name = Buffer.from(host, "ascii");
  const ext = (type, data) => Buffer.concat([u16(type), u16(data.length), data]);

  const sni = Buffer.concat([u16(name.length + 3), Buffer.from([0]), u16(name.length), name]);
  const extensions = Buffer.concat([
    ext(0x0000, sni), // server_name
    ext(0x000a, Buffer.concat([u16(6), Buffer.from([0x00, 0x1d, 0x00, 0x17, 0x00, 0x18])])), // supported_groups
    ext(0x000b, Buffer.from([0x01, 0x00])), // ec_point_formats
    ext(0x000d, Buffer.concat([u16(16), Buffer.from([0x04, 0x03, 0x08, 0x04, 0x04, 0x01, 0x05, 0x03, 0x08, 0x05, 0x05, 0x01, 0x08, 0x06, 0x06, 0x01])])), // signature_algorithms
    ext(0xff01, Buffer.from([0x00])), // renegotiation_info
    ext(0x0017, Buffer.alloc(0)), // extended_master_secret
    ext(0x0016, Buffer.alloc(0)), // encrypt_then_mac
    ext(0x0023, Buffer.alloc(0)), // session_ticket
  ]);

  const ciphers = Buffer.from([
    0xc0, 0x2f, 0xc0, 0x2b, 0xc0, 0x30, 0xc0, 0x2c, 0x00, 0x9c, 0x00, 0x35, 0x00, 0x2f, 0x00, 0x0a,
  ]);
  const random = crypto.getRandomValues(new Uint8Array(32));
  const body = Buffer.concat([
    Buffer.from([0x03, 0x03]), // TLS 1.2 (no supported_versions ext -> max 1.2)
    random,
    Buffer.from([0x00]), // session id length
    u16(ciphers.length),
    ciphers,
    Buffer.from([0x01, 0x00]), // compression: null
    u16(extensions.length),
    extensions,
  ]);
  const handshake = Buffer.concat([Buffer.from([0x01]), u24(body.length), body]);
  return Buffer.concat([Buffer.from([0x16, 0x03, 0x01]), u16(handshake.length), handshake]);
}

// Returns the leaf certificate DER, null while more bytes are needed, and
// throws on an Alert record (handshake rejected, e.g. TLS 1.3-only server).
export function extractLeafCert(buf) {
  const handshakeParts = [];
  let off = 0;
  while (off + 5 <= buf.length) {
    const type = buf[off];
    const len = buf.readUInt16BE(off + 3);
    if (off + 5 + len > buf.length) return null; // incomplete record
    if (type === 21) throw new Error("TLS alert received");
    if (type === 22) handshakeParts.push(buf.subarray(off + 5, off + 5 + len));
    off += 5 + len;
  }
  const h = Buffer.concat(handshakeParts);
  // If the server negotiated TLS 1.3 the certificate is encrypted.
  if (h.length >= 6 && h[0] === 2 && h[4] === 0x03 && h[5] === 0x04)
    throw new Error("TLS 1.3 negotiated, certificate not readable");
  let hoff = 0;
  while (hoff + 4 <= h.length) {
    const mtype = h[hoff];
    const mlen = h.readUIntBE(hoff + 1, 3);
    if (hoff + 4 + mlen > h.length) return null; // incomplete message
    if (mtype === 11) {
      // Certificate: 3-byte list length, then 3-byte length + DER per cert
      const end = hoff + 4 + mlen;
      let coff = hoff + 7;
      if (coff + 3 <= end) {
        const certLen = h.readUIntBE(coff, 3);
        if (coff + 3 + certLen <= end)
          return Buffer.from(h.subarray(coff + 3, coff + 3 + certLen));
      }
      return null;
    }
    hoff += 4 + mlen;
  }
  return null;
}

export const dnField = (dn, field) =>
  (dn.match(new RegExp(`(?:^|[\\n,])${field}=([^,\\n]+)`)) || [])[1] || dn;
