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
  const evidenceDownloadUrl = String(result?.evidence_report?.download_url ?? "").trim();
  const evidenceFileName = String(result?.evidence_report?.file_name ?? "evidence-report.json").trim();

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
    const apiCallText = escapeHtml(getApiCallSummary(item));
    const reasonText = escapeHtml(getHumanReadableReason(item));
    const statusChip = buildStatusChip(item, status, statusClass);
    const checksPie = buildChecksPieCell(item);

    return `
      <tr>
        <td>${controlId}</td>
        <td>${controlName}</td>
        <td>${statusChip}</td>
        <td>${checksPie}</td>
        <td>${apiCallText}</td>
        <td>${reasonText}</td>
        <td>${repository}</td>
      </tr>
    `;
  }).join("");

  resultBox.innerHTML = `
    <div class="compliance-summary-grid">${complianceSummary}</div>
    ${evidenceDownloadUrl ? `
      <div style="margin: 10px 0 14px 0;">
        <a href="${escapeHtml(evidenceDownloadUrl)}" download="${escapeHtml(evidenceFileName)}" style="display:inline-block;padding:8px 12px;border:1px solid #cdd9ea;border-radius:8px;text-decoration:none;color:#0f4f94;background:#f6f9ff;font-weight:600;">
          Download Evidence Report
        </a>
      </div>
    ` : ""}
    <div class="table-wrap">
      <table class="result-table">
        <thead>
          <tr>
            <th>Control ID</th>
            <th>Control Name</th>
            <th>Status</th>
            <th>Checks</th>
            <th>API Call Reason</th>
            <th>Status Reason</th>
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

function getHumanReadableReason(item) {
  const text = String(item?.fail_reason ?? item?.findings ?? item?.answer ?? "").trim();
  if (text) {
    return humanizeReasonText(text);
  }

  const status = String(item?.status ?? "UNDETERMINED").toUpperCase();
  if (status === "PASS") return "Control passed based on the available repository evidence.";
  if (status === "FAIL") return "Control failed based on the available repository evidence.";
  if (status === "ERROR") return "Evaluation failed due to a tool or processing error.";
  return "Insufficient or unclear evidence to determine compliance.";
}

function getApiCallSummary(item) {
  const mode = String(item?.api_call ?? "").trim().toUpperCase() || "UNKNOWN";
  const modeLabel = toHumanApiMode(mode);
  const reason = humanizeApiCallReason(item?.api_call_reason);
  return reason ? `${modeLabel}. ${reason}` : modeLabel;
}

function toHumanApiMode(mode) {
  if (mode === "MCP") return "API mode: MCP";
  if (mode === "REST") return "API mode: REST";
  if (mode === "MCP+REST") return "API mode: MCP and REST";
  if (mode === "NONE") return "API mode: unavailable";
  return "API mode: unknown";
}

function humanizeApiCallReason(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  const normalized = humanizeReasonText(text)
    .replace(/Tool is exposed by MCP and selected by execution preference\./gi, "The tool is exposed in MCP and MCP was selected by preference.")
    .replace(/MCP registry supports the tool but it is not exposed; REST fallback selected\./gi, "The tool is supported in MCP but not exposed, so REST fallback was used.")
    .replace(/REST selected by registry support and execution preference\./gi, "REST was selected based on tool support and execution preference.")
    .replace(/No executable strategy found \(([^)]*)\)\.?/gi, (_match, details) => `No executable API strategy was found (${humanizeStrategyDetails(details)}).`);

  return normalized;
}

function humanizeStrategyDetails(details) {
  return String(details ?? "")
    .replace(/supportsMcp=/g, "supports MCP: ")
    .replace(/exposedByMcp=/g, "exposed by MCP: ")
    .replace(/supportsRest=/g, "supports REST: ")
    .replace(/preference=/g, "preference: ")
    .replace(/\s*,\s*/g, ", ");
}

function humanizeReasonText(value) {
  return String(value ?? "")
    .replace(/\s*\|\s*/g, "; ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*/g, ": ")
    .replace(/\s*;\s*/g, "; ")
    .trim();
}

function getCheckStatusCounts(item) {
  const checks = Array.isArray(item?.check_results) ? item.check_results : [];
  if (checks.length === 0) {
    const status = String(item?.status ?? "").toUpperCase();
    return {
      pass: status === "PASS" ? 1 : 0,
      fail: status === "FAIL" || status === "ERROR" ? 1 : 0,
      total: status ? 1 : 0
    };
  }

  let pass = 0;
  let fail = 0;
  for (const check of checks) {
    const status = String(check?.status ?? "").toUpperCase();
    if (status === "PASS") pass += 1;
    if (status === "FAIL" || status === "ERROR") fail += 1;
  }
  return { pass, fail, total: checks.length };
}

function buildChecksPieCell(item) {
  const counts = getCheckStatusCounts(item);
  const totalForChart = Math.max(1, counts.pass + counts.fail);
  const passDeg = Math.round((counts.pass / totalForChart) * 360);
  const centerLabel = counts.fail === 0
    ? `${counts.pass}/${counts.total}`
    : counts.pass === 0
      ? `${counts.fail}/${counts.total}`
      : `${counts.pass}/${counts.fail}`;
  const pieStyle = `background: conic-gradient(#2e7d32 0deg ${passDeg}deg, #d32f2f ${passDeg}deg 360deg);`;

  return `
    <div style="display:flex;align-items:center;justify-content:center;">
      <div style="position:relative;width:36px;height:36px;border-radius:50%;${pieStyle}">
        <div style="position:absolute;inset:5px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#1f2937;">
          ${escapeHtml(centerLabel)}
        </div>
      </div>
    </div>
  `;
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
