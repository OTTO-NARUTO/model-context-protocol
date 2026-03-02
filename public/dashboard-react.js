const { useEffect, useMemo, useState } = React;
const {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  CssBaseline,
  Grid,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ThemeProvider,
  Tooltip,
  Typography,
  createTheme
} = MaterialUI;

const provider = window.location.pathname.split("/").filter(Boolean).pop();
const AUTO_LOGOUT_MS = 30 * 60 * 1000;
const complianceStandardMap = {
  iso27001: "ISO27001"
};

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#0068D1" },
    background: { default: "#FFFFFF", paper: "#FFFFFF" }
  },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: "none", fontWeight: 700 }
      }
    }
  }
});

function statusChip(status, detailText) {
  const normalized = String(status || "UNDETERMINED").toUpperCase();
  const colorMap = {
    PASS: "success",
    FAIL: "error",
    ERROR: "error",
    UNDETERMINED: "default"
  };
  const chip = (
    <Chip
      label={normalized}
      color={colorMap[normalized] || "default"}
      size="small"
      variant={normalized === "UNDETERMINED" ? "outlined" : "filled"}
      sx={{ fontWeight: 700 }}
    />
  );
  return detailText ? <Tooltip title={detailText}><Box component="span">{chip}</Box></Tooltip> : chip;
}

function getHumanReadableReason(item) {
  const text = String(item?.fail_reason || item?.findings || item?.answer || "").trim();
  if (text) return text;

  const status = String(item?.status || "UNDETERMINED").toUpperCase();
  if (status === "PASS") return "Control passed based on the available repository evidence.";
  if (status === "FAIL") return "Control failed based on the available repository evidence.";
  if (status === "ERROR") return "Evaluation failed due to a tool or processing error.";
  return "Insufficient or unclear evidence to determine compliance.";
}

function getApiCallSummary(item) {
  const mode = String(item?.api_call || "").trim().toUpperCase() || "UNKNOWN";
  const reason = String(item?.api_call_reason || "").trim();
  return reason ? `${mode}: ${reason}` : mode;
}

function NotificationToast({ message, severity = "info" }) {
  const variant = String(severity || "info").toLowerCase();
  const palette = {
    success: { bg: "#DCFCE7", border: "#22C55E", text: "#14532D", icon: "#16A34A" },
    info: { bg: "#DBEAFE", border: "#3B82F6", text: "#1E3A8A", icon: "#2563EB" },
    warning: { bg: "#FEF3C7", border: "#F59E0B", text: "#78350F", icon: "#D97706" },
    error: { bg: "#FEE2E2", border: "#EF4444", text: "#7F1D1D", icon: "#DC2626" }
  }[variant] || { bg: "#DBEAFE", border: "#3B82F6", text: "#1E3A8A", icon: "#2563EB" };

  return (
    <Box
      role="alert"
      sx={{
        bgcolor: palette.bg,
        borderLeft: `4px solid ${palette.border}`,
        color: palette.text,
        px: 1.5,
        py: 1,
        borderRadius: 1.5,
        display: "flex",
        alignItems: "center",
        gap: 1,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
        transition: "all 300ms ease-in-out",
        transformOrigin: "center",
        "&:hover": {
          filter: "brightness(0.98)",
          transform: "scale(1.03)"
        }
      }}
    >
      <Box sx={{ width: 20, height: 20, color: palette.icon, display: "inline-flex", flexShrink: 0 }}>
        <svg stroke="currentColor" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M13 16h-1v-4h1m0-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </Box>
      <Typography sx={{ fontSize: 12, fontWeight: 700 }}>
        {message}
      </Typography>
    </Box>
  );
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${path} failed (${response.status}): ${text}`);
  }
  return response.json();
}

function App() {
  const [connected, setConnected] = useState(false);
  const [availableRepos, setAvailableRepos] = useState([]);
  const [selectedRepos, setSelectedRepos] = useState([]);
  const [selectedCompliance, setSelectedCompliance] = useState("");
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "info" });

  const summary = useMemo(() => {
    const rows = Array.isArray(result?.results) ? result.results : [];
    const out = { PASS: 0, FAIL: 0, ERROR: 0, UNDETERMINED: 0 };
    for (const row of rows) {
      const key = String(row?.status || "UNDETERMINED").toUpperCase();
      out[key] = Number(out[key] || 0) + 1;
    }
    return out;
  }, [result]);

  useEffect(() => {
    let timer = null;
    let loggingOut = false;

    const resetLogoutTimer = () => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(async () => {
        if (loggingOut) return;
        loggingOut = true;
        try {
          await api(`/api/auth/${provider}/disconnect`, { method: "POST" });
        } catch (_error) {
        } finally {
          setSnackbar({ open: true, message: "Session expired. You have been logged out.", severity: "warning" });
          window.setTimeout(() => {
            window.location.href = "/";
          }, 900);
        }
      }, AUTO_LOGOUT_MS);
    };

    const events = ["click", "keydown", "mousemove", "scroll"];
    events.forEach((name) => window.addEventListener(name, resetLogoutTimer, { passive: true }));
    resetLogoutTimer();

    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, resetLogoutTimer));
    };
  }, []);

  useEffect(() => {
    async function init() {
      setError("");
      try {
        const status = await api(`/api/auth/${provider}/status`);
        setConnected(Boolean(status.connected));
      } catch {
        setConnected(false);
      }

      try {
        setLoadingRepos(true);
        const body = await api(`/api/auth/repos/list?provider=${encodeURIComponent(provider)}`);
        const repos = Array.isArray(body?.repos) ? body.repos : [];
        const names = repos.map((repo) => String(repo?.name || "").trim()).filter(Boolean);
        setAvailableRepos(names);
        setSelectedRepos(names);
      } catch {
        setAvailableRepos([]);
        setSelectedRepos([]);
      } finally {
        setLoadingRepos(false);
      }
    }
    init();
  }, []);

  async function handleDisconnect() {
    try {
      await api(`/api/auth/${provider}/disconnect`, { method: "POST" });
    } catch (_error) {
    } finally {
      setSnackbar({ open: true, message: "Disconnected.", severity: "info" });
      window.setTimeout(() => {
        window.location.href = "/";
      }, 700);
    }
  }

  async function runCompliance() {
    setError("");
    setResult(null);
    if (selectedRepos.length === 0) {
      setError("Select at least one repository first.");
      return;
    }
    if (!selectedCompliance) {
      setError("Select a compliance first.");
      return;
    }

    const standard = complianceStandardMap[selectedCompliance];
    if (!standard) {
      setError(`No standard configured for ${selectedCompliance}.`);
      return;
    }

    try {
      setRunning(true);
      const body = await api("/api/compliance/evaluate-standard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          standard,
          provider,
          repoNames: selectedRepos
        })
      });
      setResult(body);
    } catch (runError) {
      setError(String(runError));
    } finally {
      setRunning(false);
    }
  }

  const rows = Array.isArray(result?.results) ? result.results : [];
  const selectedCount = selectedRepos.length;

  function repositoryHelperText(name) {
    const lowered = String(name || "").toLowerCase();
    if (lowered.includes("frontend")) return "Main frontend application";
    if (lowered.includes("backend")) return "REST API service";
    if (lowered.includes("mobile")) return "Mobile application";
    if (lowered.includes("infra")) return "Infrastructure as code";
    if (lowered.includes("doc")) return "Project documentation";
    return "Repository";
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={2.5}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Stack spacing={0.2}>
              <Typography variant="h4" sx={{ color: "#0f172a", fontWeight: 800 }}>
                Dashboard
              </Typography>
              <Typography variant="body2" sx={{ color: "#64748b" }}>
                Manage your compliance scanning
              </Typography>
            </Stack>
            <Button variant="outlined" onClick={handleDisconnect} sx={{ borderColor: "#d0d7e2", color: "#111827", minWidth: 112 }}>
              Disconnect
            </Button>
          </Stack>

          <Paper elevation={0} sx={{ p: 2.25, border: "1px solid #d8dee8", borderRadius: 2.5 }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box sx={{ width: 20, height: 20, color: connected ? "#22c55e" : "#ef4444" }}>
                <svg stroke="currentColor" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Box>
              <Stack spacing={0.2}>
                <Typography sx={{ fontWeight: 700, color: "#111827" }}>
                  {connected ? `Connected to ${provider.charAt(0).toUpperCase()}${provider.slice(1)}` : `Disconnected from ${provider}`}
                </Typography>
                <Typography variant="body2" sx={{ color: "#64748b" }}>
                  {connected ? "Connection active and ready" : "Please connect to continue"}
                </Typography>
              </Stack>
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ p: 2.5, border: "1px solid #d8dee8", borderRadius: 2.5 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="h6" sx={{ color: "#111827", fontWeight: 700 }}>Select Repositories</Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="outlined" onClick={() => setSelectedRepos(availableRepos)} disabled={availableRepos.length === 0}>Select All</Button>
                <Button size="small" variant="outlined" onClick={() => setSelectedRepos([])} disabled={selectedRepos.length === 0}>Clear</Button>
              </Stack>
            </Stack>

            {loadingRepos ? (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
                <CircularProgress size={18} sx={{ color: "#0068D1" }} />
                <Typography variant="body2">Loading repositories...</Typography>
              </Stack>
            ) : (
              <List disablePadding>
                {availableRepos.map((name) => {
                  const checked = selectedRepos.includes(name);
                  return (
                    <ListItem key={name} disableGutters sx={{ py: 1.15 }}>
                      <Checkbox
                        checked={checked}
                        onChange={() => {
                          setSelectedRepos((prev) => (
                            prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]
                          ));
                        }}
                        sx={{ mr: 1 }}
                      />
                      <ListItemText
                        primary={<Typography sx={{ fontWeight: 700, color: "#0f172a" }}>{name}</Typography>}
                        secondary={<Typography variant="body2" sx={{ color: "#64748b" }}>{repositoryHelperText(name)}</Typography>}
                      />
                    </ListItem>
                  );
                })}
              </List>
            )}
            <Typography variant="body2" sx={{ color: "#64748b", mt: 0.5 }}>
              {selectedCount} of {availableRepos.length} repositories selected
            </Typography>
          </Paper>

          <Paper elevation={0} sx={{ p: 2.5, border: "1px solid #d8dee8", borderRadius: 2.5 }}>
            <Typography variant="h6" sx={{ color: "#111827", fontWeight: 700, mb: 2 }}>Select Compliance Standard</Typography>
            <Grid container spacing={1.5}>
              <Grid item xs={12} md={12}>
                <Button
                  fullWidth
                  variant={selectedCompliance === "iso27001" ? "contained" : "outlined"}
                  onClick={() => setSelectedCompliance("iso27001")}
                  sx={{
                    justifyContent: "flex-start",
                    py: 1.2,
                    color: selectedCompliance === "iso27001" ? "#fff" : "#0f172a",
                    bgcolor: selectedCompliance === "iso27001" ? "#0068D1" : "#fff",
                    borderColor: "#d0d7e2",
                    "&:hover": { bgcolor: selectedCompliance === "iso27001" ? "#0058b3" : "#f8fbff" }
                  }}
                >
                  ISO 27001
                </Button>
              </Grid>
            </Grid>
          </Paper>

          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              variant="contained"
              onClick={runCompliance}
              disabled={running || selectedRepos.length === 0 || !selectedCompliance}
              sx={{ bgcolor: "#0068D1", px: 3, py: 1.1, borderRadius: 1.5, "&:hover": { bgcolor: "#0058b3" } }}
            >
              {running ? "Running..." : "Run Compliance Check"}
            </Button>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}

          {(running || result) && (
            <Paper elevation={0} sx={{ p: 3, border: "1px solid #d9e8f9" }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Test Result</Typography>
              {running && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={20} sx={{ color: "#0068D1" }} />
                  <Typography variant="body2">One moment please...</Typography>
                </Stack>
              )}

              {!running && rows.length > 0 && (
                <Stack spacing={2}>
                  <Grid container spacing={1.5}>
                    {Object.entries(summary).map(([key, count]) => (
                      <Grid item xs={6} md={3} key={key}>
                        <Card variant="outlined" sx={{ borderColor: "#d9e8f9" }}>
                          <CardContent sx={{ py: 1.5 }}>
                            <Typography variant="caption" color="text.secondary">{key.replaceAll("_", " ")}</Typography>
                            <Typography
                              variant="h5"
                              sx={{ mt: 0.75, fontWeight: 800, color: "#0f172a" }}
                            >
                              {count}
                            </Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                    ))}
                  </Grid>

                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Control ID</TableCell>
                          <TableCell>Control Name</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>API Call (Why)</TableCell>
                          <TableCell>Reason</TableCell>
                          <TableCell>Repository</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.map((item, index) => {
                          const status = String(item?.status || "UNDETERMINED").toUpperCase();
                          const reason = getHumanReadableReason(item);
                          const apiCall = getApiCallSummary(item);
                          return (
                            <TableRow key={`${item?.repository || "repo"}-${item?.control || "ctrl"}-${index}`}>
                              <TableCell>{String(item?.control || "-")}</TableCell>
                              <TableCell>{String(item?.description || item?.control_name || "-")}</TableCell>
                              <TableCell>{statusChip(status)}</TableCell>
                              <TableCell>{apiCall}</TableCell>
                              <TableCell>{reason}</TableCell>
                              <TableCell>{String(item?.repository || result?.repository || "-")}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Stack>
              )}

              {!running && rows.length === 0 && (
                <Typography variant="body2">No control results found.</Typography>
              )}
            </Paper>
          )}
        </Stack>
      </Container>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={2500}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Box onClick={() => setSnackbar({ ...snackbar, open: false })} sx={{ cursor: "pointer" }}>
          <NotificationToast message={snackbar.message} severity={snackbar.severity} />
        </Box>
      </Snackbar>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
