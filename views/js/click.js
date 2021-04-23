console.log("JS LOADED");

const displayResponse = function (response) {
  document.getElementById("wrapper").style.height = "125px";
  const disp = document.getElementById("response");
  if (response.state == true) {
    disp.innerText = "Site looks up from here.";
    console.log("true");
  } else {
    disp.innerText = "Site not responding.";
  }
  disp.style.display = "block";
};

function logSubmit(event) {
  event.preventDefault();
  let url = document.getElementById("url").value;
  const data = { url: url };
  console.log(data);
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
