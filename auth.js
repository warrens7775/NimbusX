async function postJson(url, payload) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  } catch (error) {
    return { ok: false, message: "Server connection failed. Please start app.py." };
  }
}

const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("formMessage");
    const fullName = document.getElementById("fullName").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const result = await postJson("/api/register", { fullName, email, password });
    message.textContent = result.message || "Request failed";
    if (result.ok) {
      message.style.color = "#7de7c2";
      localStorage.setItem("nimbusUser", JSON.stringify(result.user || { fullName, email }));
      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 900);
    } else {
      message.style.color = "#ff9ea8";
    }
  });
}

const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("formMessage");
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const result = await postJson("/api/login", { email, password });
    message.textContent = result.message || "Request failed";
    if (result.ok) {
      message.style.color = "#7de7c2";
      localStorage.setItem("nimbusUser", JSON.stringify(result.user || { email }));
      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 700);
    } else {
      message.style.color = "#ff9ea8";
    }
  });
}
