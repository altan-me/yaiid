const disp = document.getElementById("response");
const detail = document.getElementById("detail");
const tlsStats = document.getElementById("tlsStats");

const populateUI = function (main, subcontent, height) {
  document.getElementById("wrapper").style.height = height;
  disp.innerText = main;
  disp.style.display = "block";

  if (subcontent == "") {
    detail.innerText = "";
    detail.style.display = "none";
  } else {
    detail.innerText = subcontent;
    detail.style.display = "block";
  }
};

const displayResponse = function (response) {
  if (response.state == true) {
    let innerText =
      `${response.url ? `🌏 ${response.url}` : ""}` +
      `${response.url && response.ip ? " " : ""}` +
      `${response.ip ? `💻 ${response.ip}` : ""}`;

    populateUI("✅ Site looks up from here.", innerText, "auto");
  } else if (response.state == false) {
    populateUI("❌ Site not responding.", " ", "127px");
  } else {
    populateUI(response.error, " ", "127px");
  }
};

const escapeHtml = function (s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
};

const displayTLSStats = function (response) {
  // Clear previous data
  tlsStats.innerHTML = "";

  if (!response || response.error || response.TLS_Check) {
    tlsStats.innerHTML =
      `<div class="cert-card"><span class="badge bad">⚠️ ${escapeHtml(
        (response && (response.error || response.TLS_Check)) || "No TLS data"
      )}</span></div>`;
    return;
  }

  const status = response.status || "unknown";
  const [icon, label, cls] = {
    valid: ["✅", "Certificate valid", "ok"],
    expired: ["❌", "Certificate expired", "bad"],
    "not yet valid": ["⏳", "Certificate not yet valid", "warn"],
    invalid: ["❌", "Certificate invalid", "bad"],
  }[status] || ["❔", status, "warn"];

  const days = response.daysUntilExpiry;
  const daysCls =
    days == null ? "" : days < 14 ? "bad" : days < 30 ? "warn" : "ok";
  const daysBadge =
    days == null
      ? ""
      : days < 0
        ? `<span class="badge bad">expired ${-days} days ago</span>`
        : `<span class="badge ${daysCls}">${days} days left</span>`;
  const wildcardBadge =
    response.isWildcard === "yes" ? `<span class="badge wildcard">wildcard</span>` : "";

  const row = (key, val, valCls = "") =>
    `<div class="cert-row"><span class="cert-key">${escapeHtml(key)}</span>` +
    `<span class="cert-val ${valCls}">${escapeHtml(val ?? "—")}</span></div>`;

  const sans = Array.isArray(response.sans) ? response.sans : [];
  const sansRow = sans.length
    ? `<div class="cert-row"><span class="cert-key">SANs</span>` +
      `<span class="cert-val sans">${sans
        .map((s) => `<span class="chip">${escapeHtml(s)}</span>`)
        .join("")}</span></div>`
    : "";

  tlsStats.innerHTML =
    `<div class="cert-card">` +
    `<div class="cert-status"><span class="badge ${cls}">${icon} ${escapeHtml(label)}</span>${daysBadge}${wildcardBadge}</div>` +
    `<div class="cert-grid">` +
    row("Subject", response.subject) +
    row("Issuer", response.issuer) +
    row("Valid from", response.validFrom) +
    row("Valid to", response.validTo) +
    row("Days until expiry", days, `days ${daysCls}`) +
    row("Public key", response.publicKeyAlgorithm) +
    row("Server", response.server) +
    sansRow +
    `</div></div>`;
};

const logSubmit = async function (event) {
  event.preventDefault();
  populateUI("Checking URL..", " ", "127px");

  let url = document.getElementById("url").value;
  const data = { url: url };

  // Run both checks concurrently and wait for all to settle
  await Promise.allSettled([
    fetch("/ping", {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
      method: "POST",
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Ping failed with status: ${response.status}`);
      return response.json();
    }),

    fetch("/check-tls-stats", {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
      method: "POST",
    }).then(async (response) => {
      if (!response.ok) throw new Error(`TLS check failed with status: ${response.status}`);
      return response.json();
    })
  ])
  .then((results) => {
    // Results[0] is for /ping, Results[1] is for /check-tls-stats.
    // allSettled never rejects: a failed fetch lands here as { status: "rejected" }.
    const pingData =
      results[0].status === "fulfilled"
        ? results[0].value
        : { error: String(results[0].reason?.message || "Ping check failed") };
    const tlsStatsData =
      results[1].status === "fulfilled"
        ? results[1].value
        : { error: String(results[1].reason?.message || "TLS check failed") };

    displayResponse(pingData);
    displayTLSStats(tlsStatsData);
  })
  .catch((error) => {
    console.error("An error occurred during site checking:", error);
    // Handle general failure case if both promises fail or one throws an error
    populateUI("❌ Could not check status.", `Error: ${error.message}. Please try again.`, "127px");
  });
}

let form = document.getElementById("pingCheck");
form.addEventListener("submit", logSubmit);
