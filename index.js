"use strict";

const express = require("express");
const app = express();
const { body, validationResult } = require("express-validator");
const path = require("path");
const { tcpPingPort } = require("tcp-ping-port");
const ping = require("ping");
const { promisify } = require("util");

// App Configuration
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

app.use(
  express.urlencoded({
    extended: true,
  })
);

// Parse JSON bodies (as sent by API clients)
app.use(express.json());

const cleanUrl = function (url) {
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
  console.log(online);
  return online;
};

//Return IP on index page
app.get("/", (req, res) => {
  res.render("index", { title: "YetAnotherIsItDown" });
});

// Access the parse results as request.body
app.post("/ping", async function (req, res) {
  console.log(`res = ${req.body.url}`);
  console.log(`res = ${cleanUrl(req.body.url)}`);
  let url = cleanUrl(req.body.url);

  if (req.body.url == "") {
    let error = "No URL / IP provided";
    res.json({ error: error });
  } else {
    console.log("req has value");
    let result = await pingHosts(url);
    res.json({ state: result.online, ip: result.ip, url: url });
  }
});

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
app.listen(port, () => console.log(`🚀 Server running on port ${[port]}`));
