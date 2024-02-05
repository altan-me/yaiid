console.log("JS LOADED");
const disp = document.getElementById("response");
const detail = document.getElementById("detail");
const tlsStats = document.getElementById("tlsStats");

const populateUI = function (main, subcontent, visibility, height) {
  document.getElementById("wrapper").style.height = height;
  disp.innerText = main;

  if (visibility) {
    disp.style.display = "block";
  } else {
    disp.style.display = "none";
  }
  if (detail == "") {
    detail.innerText = "";
  } else {
    detail.innerText = subcontent;
    detail.style.display = "block";
  }
};

const displayResponse = function (response) {
  if (response.state == true) {
    // let innerText = `URL: ${response.url} IP: ${response.ip}`;
    let innerText =
      `${response.url ? `🌏 ${response.url}` : ""}` +
      `${response.url && response.ip ? " " : ""}` +
      `${response.ip ? `💻 ${response.ip}` : ""}`;

    populateUI("✅ Site looks up from here.", innerText, true, "160px");
  } else if (response.state == false) {
    populateUI("❌ Site not responding.", " ", true, "127px");
  } else {
    populateUI(response.error, " ", true, "127px");
  }
};

const displayTLSStats = function (response) {
  // Clear previous data
  tlsStats.innerHTML = "";

  try {
    // Create a table to display the results
    let table = document.createElement("table");
    table.classList.add("tls-stats");

    // Add the table rows for each property
    Object.keys(response).forEach((property) => {
      let row = document.createElement("tr");

      // Add the property name cell
      let nameCell = document.createElement("td");
      nameCell.textContent = property + ":";
      nameCell.classList.add("tls-property");
      row.appendChild(nameCell);

      // Add the value cell
      let valueCell = document.createElement("td");
      let value = response[property];

      // Check if value is an array and handle accordingly
      if (Array.isArray(value)) {
        // Create a container for array items if they exist
        let list = document.createElement("ul");
        list.classList.add("tls-value-list");
        value.forEach((item) => {
          let listItem = document.createElement("li");
          listItem.textContent = item;
          list.appendChild(listItem);
        });
        valueCell.appendChild(list);
      } else {
        // Handle non-array values
        valueCell.textContent = value;
      }

      valueCell.classList.add("tls-value");
      row.appendChild(valueCell);
      table.appendChild(row);
    });

    // Add the table to the div
    tlsStats.appendChild(table);
  } catch (err) {
    // Display error message if any
    tlsStats.textContent = "Error: " + err.message;
  }
};

function logSubmit(event) {
  event.preventDefault();
  populateUI("Checking URL..", " ", true, "127px");
  let url = document.getElementById("url").value;
  const data = { url: url };
  fetch("/ping", {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
    method: "POST",
  })
    .then((response) => response.json())
    .then((data) => {
      displayResponse(data);
    })
    .catch((error) => {
      console.error("Error:", error);
    });

  fetch("/check-tls-stats", {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
    method: "POST",
  })
    .then((response) => response.json())
    .then((data) => {
      displayTLSStats(data);
    })
    .catch((error) => {
      console.error("Error:", error);
    });
}

let form = document.getElementById("pingCheck");
form.addEventListener("submit", logSubmit);
