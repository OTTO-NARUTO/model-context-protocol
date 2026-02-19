const provider = window.location.pathname.split("/").filter(Boolean).pop();
const dashboardTitle = document.getElementById("dashboardTitle");
const statusPill = document.getElementById("statusPill");
const disconnectBtn = document.getElementById("disconnectBtn");
const repoSelect = document.getElementById("repoSelect");
const complianceSection = document.getElementById("complianceSection");
const complianceSelect = document.getElementById("complianceSelect");
const runComplianceTestBtn = document.getElementById("runComplianceTestBtn");
const resultSection = document.getElementById("resultSection");
const resultBox = document.getElementById("resultBox");
const SINGLE_TENANT_ID = "tenant-acme";
const AUTO_LOGOUT_MS = 30 * 60 * 1000;
let logoutTimerId = null;
let logoutInProgress = false;

const complianceStandardMap = {
  iso27001: "ISO27001",
  soc2: "SOC2"
};

dashboardTitle.textContent = `${provider} Dashboard`;

function tenantHeader() {
  return { "x-tenant-id": SINGLE_TENANT_ID };
}

function updateComplianceVisibility() {
  const hasRepo = Boolean(repoSelect.value);
  complianceSection.hidden = !hasRepo;
  if (!hasRepo) {
    complianceSelect.value = "";
    resultSection.hidden = true;
    resultBox.textContent = "No result yet.";
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...tenantHeader()
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${path} failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function refreshStatus() {
  try {
    const status = await api(`/api/auth/${provider}/status`);
    const connected = Boolean(status.connected);
    statusPill.className = `status-pill ${connected ? "connected" : "disconnected"}`;
    statusPill.textContent = connected ? "Connected" : "Disconnected";
  } catch {
    statusPill.className = "status-pill disconnected";
    statusPill.textContent = "Disconnected";
  }
}

async function loadRepos() {
  repoSelect.innerHTML = '<option value="">Loading repositories...</option>';

  try {
    const body = await api(`/api/auth/repos/list?provider=${encodeURIComponent(provider)}`);
    const repos = Array.isArray(body.repos) ? body.repos : [];

    if (repos.length === 0) {
      repoSelect.innerHTML = '<option value="">No repositories found</option>';
      updateComplianceVisibility();
      return;
    }

    const options = repos.map((repo) => `<option value="${repo.name}">${repo.name}</option>`).join("");
    repoSelect.innerHTML = `<option value="">Select repository</option>${options}`;
    updateComplianceVisibility();
  } catch (error) {
    repoSelect.innerHTML = '<option value="">Connect provider to load repositories</option>';
    updateComplianceVisibility();
    console.error(error);
  }
}

async function runComplianceTest() {
  const selectedRepo = repoSelect.value;
  const selectedCompliance = complianceSelect.value;

  if (!selectedRepo) {
    resultSection.hidden = false;
    resultBox.textContent = "Select a repository first.";
    return;
  }

  if (!selectedCompliance) {
    resultSection.hidden = false;
    resultBox.textContent = "Select a compliance first.";
    return;
  }

  const standard = complianceStandardMap[selectedCompliance];
  if (!standard) {
    resultSection.hidden = false;
    resultBox.textContent = `No standard configured for ${selectedCompliance}.`;
    return;
  }

  resultSection.hidden = false;
  resultBox.textContent = "Running compliance test...";

  try {
    const result = await api("/api/compliance/evaluate-standard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        standard,
        provider,
        repoName: selectedRepo
      })
    });

    resultBox.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    resultBox.textContent = String(error);
  }
}

disconnectBtn.addEventListener("click", async () => {
  await handleLogout("Disconnected.");
});

repoSelect.addEventListener("change", updateComplianceVisibility);
runComplianceTestBtn.addEventListener("click", runComplianceTest);

Promise.all([refreshStatus(), loadRepos()]);

function resetLogoutTimer() {
  if (logoutTimerId) {
    clearTimeout(logoutTimerId);
  }
  logoutTimerId = window.setTimeout(() => {
    handleLogout("Session expired. You have been logged out.");
  }, AUTO_LOGOUT_MS);
}

async function handleLogout(message) {
  if (logoutInProgress) {
    return;
  }
  logoutInProgress = true;
  if (logoutTimerId) {
    clearTimeout(logoutTimerId);
    logoutTimerId = null;
  }

  try {
    await api(`/api/auth/${provider}/disconnect`, { method: "POST" });
  } catch (error) {
    console.error(error);
  } finally {
    repoSelect.value = "";
    complianceSelect.value = "";
    updateComplianceVisibility();
    await refreshStatus();
    alert(message);
    window.location.href = "/";
  }
}

["click", "keydown", "mousemove", "scroll"].forEach((eventName) => {
  window.addEventListener(eventName, resetLogoutTimer, { passive: true });
});
resetLogoutTimer();
