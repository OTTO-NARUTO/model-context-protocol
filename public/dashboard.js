const provider = window.location.pathname.split("/").filter(Boolean).pop();
const dashboardTitle = document.getElementById("dashboardTitle");
const statusPill = document.getElementById("statusPill");
const disconnectBtn = document.getElementById("disconnectBtn");
const repoPicker = document.getElementById("repoPicker");
const repoPickerToggle = document.getElementById("repoPickerToggle");
const repoPickerMenu = document.getElementById("repoPickerMenu");
const repoPickerList = document.getElementById("repoPickerList");
const repoSelectAllBtn = document.getElementById("repoSelectAllBtn");
const repoClearAllBtn = document.getElementById("repoClearAllBtn");
const complianceSection = document.getElementById("complianceSection");
const complianceSelect = document.getElementById("complianceSelect");
const runComplianceTestBtn = document.getElementById("runComplianceTestBtn");
const resultSection = document.getElementById("resultSection");
const resultBox = document.getElementById("resultBox");
const AUTO_LOGOUT_MS = 30 * 60 * 1000;
let logoutTimerId = null;
let logoutInProgress = false;
let availableRepos = [];
let selectedRepos = new Set();

const complianceStandardMap = {
  iso27001: "ISO27001"
};

dashboardTitle.textContent = `${provider} Dashboard`;

function updateComplianceVisibility() {
  const hasRepo = getSelectedRepos().length > 0;
  complianceSection.hidden = !hasRepo;
  if (!hasRepo) {
    complianceSelect.value = "";
    resultSection.hidden = true;
    resultBox.textContent = "No result yet.";
  }
}

function getSelectedRepos() {
  return Array.from(selectedRepos);
}

function setPickerLoading(message) {
  repoPickerToggle.textContent = message;
  repoPickerList.innerHTML = "";
}

function updatePickerSummary() {
  const total = availableRepos.length;
  const selected = selectedRepos.size;

  if (total === 0) {
    repoPickerToggle.textContent = "No repositories found";
    return;
  }

  if (selected === 0) {
    repoPickerToggle.textContent = "Select repositories";
    return;
  }

  if (selected === total) {
    repoPickerToggle.textContent = `All repositories selected (${total})`;
    return;
  }

  repoPickerToggle.textContent = `${selected} repository(ies) selected`;
}

function renderRepoPickerList() {
  if (availableRepos.length === 0) {
    repoPickerList.innerHTML = "<div class=\"repo-picker-empty\">No repositories found.</div>";
    updatePickerSummary();
    return;
  }

  const rows = availableRepos.map((name) => {
    const id = `repo-opt-${name.replaceAll("/", "-").replaceAll(".", "-")}`;
    const checked = selectedRepos.has(name) ? "checked" : "";
    const safeName = escapeHtml(name);
    return `
      <label class="repo-option" for="${id}">
        <input id="${id}" type="checkbox" data-repo-name="${safeName}" ${checked} />
        <span>${safeName}</span>
      </label>
    `;
  }).join("");

  repoPickerList.innerHTML = rows;
  updatePickerSummary();
}

async function api(path, options = {}) {
  const response = await fetch(path, options);

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
  setPickerLoading("Loading repositories...");

  try {
    const body = await api(`/api/auth/repos/list?provider=${encodeURIComponent(provider)}`);
    const repos = Array.isArray(body.repos) ? body.repos : [];
    availableRepos = repos
      .map((repo) => String(repo?.name ?? "").trim())
      .filter(Boolean);
    selectedRepos = new Set(availableRepos);

    if (availableRepos.length === 0) {
      renderRepoPickerList();
      updateComplianceVisibility();
      return;
    }

    renderRepoPickerList();
    updateComplianceVisibility();
  } catch (error) {
    availableRepos = [];
    selectedRepos = new Set();
    setPickerLoading("Connect provider to load repositories");
    updateComplianceVisibility();
    console.error(error);
  }
}

async function runComplianceTest() {
  const selectedRepos = getSelectedRepos();
  const selectedCompliance = complianceSelect.value;

  if (selectedRepos.length === 0) {
    resultSection.hidden = false;
    resultBox.textContent = "Select at least one repository first.";
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
  resultBox.innerHTML = buildLoadingMarkup();

  try {
    const result = await api("/api/compliance/evaluate-standard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        standard,
        provider,
        repoNames: selectedRepos
      })
    });

    renderResultTable(result);
  } catch (error) {
    resultBox.textContent = String(error);
  }
}

function renderResultTable(result) {
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (rows.length === 0) {
    resultBox.textContent = "No control results found.";
    return;
  }

  const statusOrder = ["PASS", "FAIL", "ERROR", "UNDETERMINED"];
  const statusCounts = new Map(statusOrder.map((status) => [status, 0]));

  for (const item of rows) {
    const status = String(item?.status ?? "UNDETERMINED").toUpperCase();
    if (statusCounts.has(status)) {
      statusCounts.set(status, Number(statusCounts.get(status) ?? 0) + 1);
    } else {
      statusCounts.set(status, 1);
    }
  }

  const complianceSummary = Array.from(statusCounts.entries()).map(([status, count]) => {
    const statusClass = statusToClass(status);
    return `
      <div class="compliance-card">
        <div class="compliance-card-title">${escapeHtml(status.replaceAll("_", " "))}</div>
        <div class="compliance-card-value"><span class="status-chip ${statusClass}">${escapeHtml(String(count))}</span></div>
      </div>
    `;
  }).join("");

  const complianceRows = rows.map((item) => {
    const repository = escapeHtml(String(item?.repository ?? result?.repository ?? "-"));
    const controlId = escapeHtml(String(item?.control ?? "-"));
    const controlName = escapeHtml(String(item?.description ?? item?.control_name ?? "-"));
    const status = String(item?.status ?? "UNDETERMINED").toUpperCase();
    const statusClass = statusToClass(status);
    const resultText = getComplianceResultText(item);
    const reasonText = escapeHtml(getHumanReadableReason(item));
    const statusChip = buildStatusChip(item, status, statusClass);

    return `
      <tr>
        <td>${controlId}</td>
        <td>${controlName}</td>
        <td>${statusChip}</td>
        <td>${escapeHtml(resultText)}</td>
        <td>${reasonText}</td>
        <td>${repository}</td>
      </tr>
    `;
  }).join("");

  resultBox.innerHTML = `
    <div class="compliance-summary-grid">${complianceSummary}</div>
    <div class="table-wrap">
      <table class="result-table">
        <thead>
          <tr>
            <th>Control ID</th>
            <th>Control Name</th>
            <th>Status</th>
            <th>Result</th>
            <th>Reason</th>
            <th>Repository</th>
          </tr>
        </thead>
        <tbody>${complianceRows}</tbody>
      </table>
    </div>
  `;
}

function statusToClass(status) {
  if (status === "PASS") return "ok";
  if (status === "FAIL") return "bad";
  if (status === "ERROR") return "err";
  return "unknown";
}

function getComplianceResultText(item) {
  if (item?.passed === true) return "Pass";
  if (item?.passed === false) return "Fail";
  const status = String(item?.status ?? "").toUpperCase();
  if (status === "PASS") return "Pass";
  if (status === "FAIL") return "Fail";
  return "Undetermined";
}

function getHumanReadableReason(item) {
  const text = String(item?.fail_reason ?? item?.findings ?? item?.answer ?? "").trim();
  if (text) {
    return text;
  }

  const status = String(item?.status ?? "UNDETERMINED").toUpperCase();
  if (status === "PASS") return "Control passed based on the available repository evidence.";
  if (status === "FAIL") return "Control failed based on the available repository evidence.";
  if (status === "ERROR") return "Evaluation failed due to a tool or processing error.";
  return "Insufficient or unclear evidence to determine compliance.";
}

function buildStatusChip(_item, status, statusClass) {
  const normalizedStatus = String(status ?? "").toUpperCase();
  return `<span class="status-chip ${statusClass}">${escapeHtml(normalizedStatus)}</span>`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildLoadingMarkup() {
  return `
    <div class="loading-state" role="status" aria-live="polite">
      <img class="loading-dog" src="/loading/pixel-dog.svg" alt="Pixel dog loading animation" />
      <p class="loading-text">One moment please...</p>
    </div>
  `;
}

disconnectBtn.addEventListener("click", async () => {
  await handleLogout("Disconnected.");
});

repoPickerToggle.addEventListener("click", () => {
  if (repoPickerMenu.hidden) {
    repoPickerMenu.hidden = false;
    repoPicker.classList.add("open");
  } else {
    repoPickerMenu.hidden = true;
    repoPicker.classList.remove("open");
  }
});

repoPickerList.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  if (target.type !== "checkbox") {
    return;
  }

  const repoName = target.dataset.repoName;
  if (!repoName) {
    return;
  }

  if (target.checked) {
    selectedRepos.add(repoName);
  } else {
    selectedRepos.delete(repoName);
  }

  updatePickerSummary();
  updateComplianceVisibility();
});

repoSelectAllBtn.addEventListener("click", () => {
  selectedRepos = new Set(availableRepos);
  renderRepoPickerList();
  updateComplianceVisibility();
});

repoClearAllBtn.addEventListener("click", () => {
  selectedRepos = new Set();
  renderRepoPickerList();
  updateComplianceVisibility();
});

document.addEventListener("click", (event) => {
  if (repoPicker.contains(event.target)) {
    return;
  }
  repoPickerMenu.hidden = true;
  repoPicker.classList.remove("open");
});

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
    availableRepos = [];
    selectedRepos = new Set();
    setPickerLoading("No repositories selected");
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
