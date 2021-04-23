console.log("JS LOADED");

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
    })
    .catch((error) => {
      console.error("Error:", error);
    });
}

let form = document.getElementById("pingCheck");
form.addEventListener("submit", logSubmit);
