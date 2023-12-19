"use strict";

const express = require("express");
const app = express();
const cloudflare = require("cloudflare-express");
const { body, validationResult } = require("express-validator");
const favicon = require("serve-favicon");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { tcpPingPort } = require("tcp-ping-port");
const ping = require("ping");
const https = require("https");

app.disable("x-powered-by");
// App Configuration
app.use((req, res, next) => {
  // Content-Security-Policy
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self';" +
      "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com;" +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;" +
      "img-src 'self';" +
      "font-src 'self' https://fonts.gstatic.com;" // Add font-src directive
    // Add other directives as needed
  );
  // X-Frame-Options
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  // Referrer-Policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(cloudflare.restore());
// app.set("trust proxy", true);
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

app.use(favicon(path.join(__dirname, "views", "favicon.ico")));
app.use(
  express.urlencoded({
    extended: true,
  })
);

// Parse JSON bodies (as sent by API clients)
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // limit each IP to 20 requests per windowMs
  message: { error: "Request limit exceeded" },
  statusCode: 429, // set the status code to 429 (Too Many Requests)
});

const isFQDN = function (input) {
  const fqdnRegex =
    /^(?!:\/\/)(?:(?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,6}$/;
  return fqdnRegex.test(input) ? input : null;
};

const checkTLSAndServerStats = async function (url) {
  return new Promise((resolve, reject) => {
    const options = {
      method: "HEAD", // Reduces response payload size
      host: url,
      port: 443,
      requestCert: true,
      rejectUnauthorized: true,
      agent: false, //stops caching
    };

    https
      .get(options, (res) => {
        const cert = res.socket.getPeerCertificate();

        // Check if certificate is valid
        let status;
        if (cert.valid_to < new Date()) {
          status = "expired";
        } else if (cert.valid_from > new Date()) {
          status = "not yet valid";
        } else {
          status = "valid";
        }

        // Get all the SANs in the certificate
        let sans = [];
        if (cert.subjectaltname) {
          sans = cert.subjectaltname.split(",").map((san) => san.trim());
        }

        // Calculate days until certificate expires
        const daysUntilExpiry = Math.ceil(
          (new Date(cert.valid_to) - new Date()) / (1000 * 60 * 60 * 24)
        );

        // Check if certificate is a wildcard certificate
        const isWildcard =
          sans.find((san) => san.startsWith("DNS:*.")) ||
          (cert.subject &&
            cert.subject.CN &&
            cert.subject.CN.startsWith("DNS:*.")) ||
          false
            ? "yes"
            : "no";

        // Build the result object
        const result = {
          subject: (cert.subject && cert.subject.CN) || "",
          issuer: (cert.issuer && cert.issuer.O) || "",
          status: status,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          publicKeyAlgorithm: cert.pubkeyAlgorithm,
          sans: sans,
          daysUntilExpiry: daysUntilExpiry,
          isWildcard: isWildcard,
          server: res.headers.server || "", // Add server information to the result object
        };

        resolve(result);
      })
      .on("error", (err) => {
        reject(new Error(`Error checking TLS stats: ${err}`));
      });
  });
};

const sanitizeInput = function (url) {
  // Check if input is a valid URL or IP
  const urlRegex =
    /^((https?|ftp):\/\/)?([^\s/$.?#].[^\s]*)|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/i;
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!url.match(urlRegex) && !url.match(ipRegex)) {
    return null;
  }

  // If input is a valid URL, extract the hostname
  const regex = /^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?]+)/;
  const match = url.match(regex);

  if (match) {
    return match[1];
  } else {
    return url.replace(/(^\w+:|^)\/\//, "");
  }
};

const pingHosts = async function (host) {
  let online = await tcpPingPort(host);
  if (!online.online && /^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    // check if input is an IP address
    const result = await ping.promise.probe(host);
    online.online = result.alive;
  }
  return online;
};

//Return IP on index page
app.get("/", (req, res) => {
  res.render("index", { title: "YetAnotherIsItDown" });
});

// Access the parse results as request.body
app.post("/ping", limiter, async function (req, res) {
  let url = sanitizeInput(req.body.url);

  if (req.body.url == "") {
    let error = "No URL / IP provided";
    res.json({ error: error });
  } else {
    let result = await pingHosts(url);
    res.json({ state: result.online, ip: result.ip, url: url });
  }
});

// POST endpoint to check TLS stats for a URL
app.post("/check-tls-stats", limiter, async (req, res) => {
  let url = sanitizeInput(req.body.url);
  url = isFQDN(url);
  if (!url) {
    res.json({ TLS_Check: "not a FQDN 😢" });
    return;
  }

  try {
    const result = await checkTLSAndServerStats(url);
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Serve security.txt
app.use(
  "/.well-known",
  express.static(path.join(__dirname, "public", ".well-known"))
);

// 404
app.use(function (req, res, next) {
  res.status(404).send(res.render("404", { title: "404" }));
});

// 500
app.use(function (err, req, res, next) {
  console.error(err.stack);
  res.status(500).send(res.render("500", { title: "500" }));
});

// Listen for Webhook Ingest
const port = process.env.PORT || 8001;
app.listen(port, () =>
  console.log(`🚀 Server running on container port ${[port]}`)
);
