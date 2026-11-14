import { connect } from "cloudflare:sockets";
import { X509Certificate } from "node:crypto";
import {
  isFQDN,
  readUrl,
  buildClientHello,
  extractLeafCert,
  dnField,
} from "./lib.js";

// keep in sync with public/_headers (asset-served responses)
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function withHeaders(res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function json(data, status = 200) {
  return withHeaders(
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    })
  );
}

// TCP check via cloudflare:sockets; opened resolves with the peer IP.
// shortcut: ICMP ping is not possible in Workers, TCP-only replaces the old
// net + ping fallback for IP inputs.
const tcpPingPort = async function (host, port = 80, timeout = 5000) {
  let socket;
  try {
    socket = connect({ hostname: host, port });
    const info = await Promise.race([
      socket.opened,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeout)
      ),
    ]);
    // remoteAddress may come back as "host:port" (e.g. in local dev)
    const ip = String(info.remoteAddress || host).replace(
      new RegExp(`:${port}$`),
      ""
    );
    return { online: true, ip };
  } catch (err) {
    return { online: false, ip: host };
  } finally {
    socket?.close().catch(() => {});
  }
};

const MAX_HANDSHAKE_BYTES = 256 * 1024; // leaf certs are a few KiB

async function fetchPeerCert(host, timeout = 5000) {
  const socket = connect({ hostname: host, port: 443 });
  try {
    const writer = socket.writable.getWriter();
    await writer.write(buildClientHello(host));
    const reader = socket.readable.getReader();
    const chunks = [];
    let total = 0;
    const read = () =>
      Promise.race([
        reader.read(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), timeout)
        ),
      ]);
    for (;;) {
      const { done, value } = await read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total > MAX_HANDSHAKE_BYTES) throw new Error("response too large");
      const cert = extractLeafCert(Buffer.concat(chunks));
      if (cert) return cert;
    }
    return null;
  } finally {
    socket.close().catch(() => {});
  }
}

const checkTLSAndServerStats = async function (host) {
  const [certResult, head] = await Promise.allSettled([
    fetchPeerCert(host),
    fetch(`https://${host}/`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    }),
  ]);

  if (certResult.status === "rejected" && head.status === "rejected") {
    throw new Error(
      `Error checking TLS stats: ${certResult.reason?.message || head.reason?.message}`
    );
  }

  const result = {};
  result.server =
    head.status === "fulfilled" ? head.value.headers.get("server") || "" : "";

  if (certResult.status === "fulfilled" && certResult.value) {
    const cert = new X509Certificate(certResult.value);
    const cn = dnField(cert.subject, "CN");
    const sans = (cert.subjectAltName || "")
      .split(",")
      .map((san) => san.trim())
      .filter(Boolean);
    const now = new Date();
    result.subject = cn;
    result.issuer = dnField(cert.issuer, "O");
    result.validFrom = cert.validFrom;
    result.validTo = cert.validTo;
    result.publicKeyAlgorithm = cert.publicKey?.asymmetricKeyType || "";
    result.daysUntilExpiry = Math.ceil(
      (new Date(cert.validTo) - now) / (1000 * 60 * 60 * 24)
    );
    result.isWildcard =
      sans.some((san) => san.replace(/^DNS:/, "").startsWith("*.")) ||
      cn.startsWith("*.")
        ? "yes"
        : "no";
    result.sans = sans;
    // Same semantics as the original: status derived from cert validity dates
    if (new Date(cert.validTo) < now) result.status = "expired";
    else if (new Date(cert.validFrom) > now) result.status = "not yet valid";
    else result.status = "valid";
  } else if (head.status === "fulfilled") {
    result.status = "valid"; // fetch() validated the live certificate
  } else {
    const msg = String(head.reason?.message || head.reason);
    result.status = /expired/i.test(msg)
      ? "expired"
      : /not yet valid|NotBefore/i.test(msg)
        ? "not yet valid"
        : "invalid";
  }
  return result;
};

async function rateLimited(request, env) {
  if (!env.RATE_LIMITER) return false;
  try {
    const key = request.headers.get("cf-connecting-ip") || "unknown";
    const { success } = await env.RATE_LIMITER.limit({ key });
    return !success;
  } catch (err) {
    // allow, but make a broken/entitlement-less binding visible in logs
    console.error("rate limiter unavailable, allowing request:", err);
    return false;
  }
}

async function handlePing(request, env) {
  if (await rateLimited(request, env))
    return json({ error: "Request limit exceeded" }, 429);

  const input = await readUrl(request);
  if (input.error) return json({ error: input.error }, input.status || 200);

  const result = await tcpPingPort(input.url);
  return json({ state: result.online, ip: result.ip, url: input.url });
}

async function handleTLSStats(request, env) {
  if (await rateLimited(request, env))
    return json({ error: "Request limit exceeded" }, 429);

  const input = await readUrl(request);
  if (input.error) return json({ error: input.error }, input.status || 200);

  const url = isFQDN(input.url);
  if (!url) {
    return json({ TLS_Check: "not a FQDN 😢" });
  }

  try {
    return json(await checkTLSAndServerStats(url));
  } catch (err) {
    return json({ error: err.message });
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (request.method === "POST" && pathname === "/ping")
        return await handlePing(request, env);
      if (request.method === "POST" && pathname === "/check-tls-stats")
        return await handleTLSStats(request, env);

      // Everything else (/, /robots.txt, /.well-known/*, css/js/images,
      // unknown paths -> 404.html via not_found_handling) comes from assets.
      return withHeaders(await env.ASSETS.fetch(request));
    } catch (err) {
      console.error(err);
      try {
        const res = await env.ASSETS.fetch(new URL("/500.html", request.url));
        const out = withHeaders(res);
        return new Response(out.body, { status: 500, headers: out.headers });
      } catch {
        return withHeaders(new Response("500 Internal Server Error", { status: 500 }));
      }
    }
  },
};
