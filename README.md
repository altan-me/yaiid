# YAIID - Yet Another Is It Down Checker

![YAIID image](https://imgur.com/LMVdvNU.png)

YAIID is a simple Cloudflare Worker that checks whether a URL or IP address is accessible using a TCP connection. This application can be useful for monitoring the availability of websites or servers.

## Getting Started

Clone the repository:

```
git clone https://github.com/altan-me/yaiid
```

Install the required dependencies:

```
cd yaiid
npm install
```

Run locally with Wrangler:

```
npm run dev
```

Deploy to Cloudflare Workers:

```
npm run deploy
```

Then attach a custom domain (e.g. `iswebsitedown.org`) to the Worker in the Cloudflare dashboard.

## How it Works

YAIID opens a raw TCP connection to port 80 of the target host using the Workers [`connect()`](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) API and reports whether the connection succeeded, along with the resolved IP. `POST /ping` accepts a domain or IP address.

`POST /check-tls-stats` accepts a FQDN and inspects the certificate server-side: it opens a raw TCP connection to port 443 via `connect()`, sends a minimal TLS 1.2 ClientHello, reads the plaintext Certificate handshake message, and parses the leaf certificate with `node:crypto`'s `X509Certificate` (Workers cannot read the peer certificate of an outbound TLS connection directly). It also performs a live HTTPS HEAD request, which validates the live certificate and returns the `server` header.

Both POST endpoints are rate limited to 20 requests per minute per IP via the Workers [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) (`ratelimits` in `wrangler.jsonc`). Note the binding counts per Cloudflare location, so the effective limit is approximate.

Run the unit tests (TLS handshake parser, input validators) with:

```
npm test
```

Static assets (pages, CSS, JS, images, `robots.txt`, `/.well-known/security.txt`) are served from `public/` via [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), with a custom `404.html`. Security headers and cache policy are set via `public/_headers` for assets and in `src/index.js` for API responses.

## Differences from the old Node/Express version

- ICMP ping is not possible in Workers; IP targets are checked over TCP only.
- Certificate details are extracted with a minimal TLS 1.2 handshake instead of `getPeerCertificate()` (not implemented in workerd); servers that negotiate TLS 1.3 only fall back to the live HTTPS check (status + `server` header, no cert fields).
- `connect()` to arbitrary hosts/ports requires the Workers TCP sockets capability (enabled on Workers plans that support `cloudflare:sockets`).

## Contributing

Contributions to YAIID are welcome! If you find a bug or have a suggestion for a new feature, please open an issue on this repository. If you'd like to contribute code to YAIID, please fork this repository and submit a pull request.
