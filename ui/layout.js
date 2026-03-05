export function applyBootUiState({ bootStatus, authStatus, persistenceMode }) {
  const chip = document.getElementById("firebase-mode");
  if (!chip) return;

  if (bootStatus === "booting") {
    chip.textContent = "Booting...";
    return;
  }

  if (bootStatus === "error") {
    chip.textContent = "Boot error (local fallback)";
    return;
  }

  if (persistenceMode === "local") {
    chip.textContent = "Local mode";
    return;
  }

  if (authStatus === "authenticated") {
    chip.textContent = "Firebase mode";
  } else {
    chip.textContent = "Firebase guest";
  }
}

export function hideLoaderShowShell() {
  const shell = document.querySelector(".app-shell");
  const loader = document.getElementById("app-loader");
  if (shell) {
    shell.style.display = "block";
    shell.classList.add("ready");
  }
  if (loader) {
    loader.style.opacity = "0";
    setTimeout(() => loader.remove(), 280);
  }
}
