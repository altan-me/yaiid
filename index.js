"use strict";

const express = require("express");
const app = express();
const { body, validationResult } = require("express-validator");
const path = require("path");
const ping = require("ping");

// App Configuration
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

// Process APP_Secret for later Verification
//app.use(xhub({ algorithm: "sha1", secret: app_secret }));
//app.use(bodyParser.json());
// app.use(express.json()); //Maybe can replace bodyParser with express

// Parse URL-encoded bodies (as sent by HTML forms)
// app.use(express.urlencoded());

app.use(
  express.urlencoded({
    extended: true,
  })
);

// Parse JSON bodies (as sent by API clients)
app.use(express.json());

const pingHosts = async function (host) {
  let res = await ping.promise.probe(host, {
    timeout: 10,
    extra: ["-i", "2"],
  });
  console.log(res);
  return res.alive;
};

// pingHosts(hosts);

//Return IP on index page
app.get("/", (req, res) => {
  // let ip = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"];
  // let ip = req.socket.remoteAddress;
  res.render("index", { title: "Up Check" });
});

// Access the parse results as request.body
app.post("/ping", async function (req, res) {
  //   console.log(req.body.url);
  let result = await pingHosts(req.body.url);
  console.log(result);
  res.json({ state: result });
  //   res.send(pingHosts(req.body.url));
  //   res.end();

  //...
  //   res.end();
  //   // Extract the validation errors from a request.
  //   const errors = validationResult(req);
  //   console.log(req);

  //   if (!errors.isEmpty()) {
  //     // There are errors. Render form again with sanitized values/errors messages.
  //     // Error messages can be returned in an array using `errors.array()`.
  //   } else {
  //     // Data from form is valid.
  //   }
  //   console.log(request.body.user.url);
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
