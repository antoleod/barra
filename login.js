import { fbService } from "./firebase-service.js";

const $ = (id) => document.getElementById(id);

const statusEl = $("login-status");
const tabGoogle = $("tab-google");
const tabPin = $("tab-pin");
const formGoogle = $("form-google");
const formPin = $("form-pin");
const btnGoogle = $("btn-google");
const btnPinLogin = $("btn-pin-login");
const pinUserInput = $("pin-user");
const pinCodeInput = $("pin-code");
const togglePinVisBtn = $("toggle-pin-vis");

const setStatus = (message, type = "error") => {
  statusEl.textContent = message;
  statusEl.style.color = type === "error" ? "var(--danger)" : type === "success" ? "var(--ok)" : "var(--muted)";
};

const setLoading = (button, isLoading) => {
  button.disabled = isLoading;
  if (isLoading) {
    button.innerHTML = `<span class="spinner" style="width:20px; height:20px; border-width:2px;"></span> Conectando...`;
  } else {
    if (button.id === "btn-google") {
      button.innerHTML = `<span>G</span> <span>Continuar con Google</span>`;
    } else {
      button.innerHTML = "Entrar / Crear";
    }
  }
};

const switchTab = (activeTab) => {
  if (activeTab === "google") {
    tabGoogle.classList.add("active");
    tabPin.classList.remove("active");
    formGoogle.style.display = "block";
    formPin.style.display = "none";
  } else {
    tabPin.classList.add("active");
    tabGoogle.classList.remove("active");
    formPin.style.display = "flex";
    formGoogle.style.display = "none";
    pinUserInput.focus();
  }
  setStatus("");
};

tabGoogle.onclick = () => switchTab("google");
tabPin.onclick = () => switchTab("pin");

togglePinVisBtn.onclick = () => {
  const isPassword = pinCodeInput.type === "password";
  pinCodeInput.type = isPassword ? "text" : "password";
  togglePinVisBtn.textContent = isPassword ? "\u{1F648}" : "\u{1F441}";
};

btnGoogle.onclick = async () => {
  if (!navigator.onLine) return setStatus("Necesitas conexion a internet para iniciar sesion.");
  setLoading(btnGoogle, true);
  setStatus("Iniciando con Google...", "info");
  const res = await fbService.loginGoogle();
  if (!res.success) {
    setLoading(btnGoogle, false);
    if (res.error.includes("popup-closed-by-user")) {
      setStatus("Proceso cancelado.");
    } else {
      setStatus("Error de autenticacion.");
    }
  }
};

btnPinLogin.onclick = async () => {
  if (!navigator.onLine) return setStatus("Necesitas conexion a internet para iniciar sesion.");

  const u = pinUserInput.value.trim();
  const p = pinCodeInput.value;
  if (!u || !p) {
    setStatus("Usuario y PIN son requeridos.");
    return;
  }

  setLoading(btnPinLogin, true);
  setStatus("Verificando...", "info");
  localStorage.setItem("lastUsername", u);

  const res = await fbService.loginPin(u, p);
  if (!res.success) {
    setLoading(btnPinLogin, false);
    setStatus(res.error);
  } else if (res.isNew) {
    setStatus("Cuenta creada. Redirigiendo...", "success");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  fbService.init((user) => {
    if (user) {
      setStatus("Sesion encontrada. Redirigiendo...", "success");
      window.location.replace("./index.html");
    }
  });

  const lastUsername = localStorage.getItem("lastUsername");
  if (lastUsername) {
    pinUserInput.value = lastUsername;
  }
});
