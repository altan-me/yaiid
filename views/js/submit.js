console.log("JS LOADED");
const disp = document.getElementById("response");
const detail = document.getElementById("detail");

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

    populateUI("Site looks up from here.", innerText, true, "160px");
  } else if (response.state == false) {
    populateUI("Site not responding.", " ", true, "127px");
  } else {
    populateUI(response.error, " ", true, "127px");
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
      console.log("Success:", data);
      displayResponse(data);
    })
    .catch((error) => {
      console.error("Error:", error);
    });
}

let form = document.getElementById("pingCheck");
form.addEventListener("submit", logSubmit);
