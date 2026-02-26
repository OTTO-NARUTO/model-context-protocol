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
  FormControl,
  Grid,
  InputLabel,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Snackbar,
  Tab,
  Tabs,
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
  iso27001: "ISO27001",
  soc2: "SOC2"
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
    COMPLIANT: "success",
    NON_COMPLIANT: "error",
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
  const [tab, setTab] = useState(0);
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "info" });

  const hasRepo = selectedRepos.length > 0;
  const statusText = connected ? "Connected" : "Disconnected";

  const summary = useMemo(() => {
    const rows = Array.isArray(result?.results) ? result.results : [];
    const out = { COMPLIANT: 0, NON_COMPLIANT: 0, ERROR: 0, UNDETERMINED: 0 };
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
    if (!hasRepo) {
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
      setTab(0);
    } catch (runError) {
      setError(String(runError));
    } finally {
      setRunning(false);
    }
  }

  const rows = Array.isArray(result?.results) ? result.results : [];

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Stack spacing={2.5}>
          <Paper elevation={0} sx={{ p: 3, border: "1px solid #d9e8f9" }}>
            <Typography variant="h4" sx={{ color: "#0068D1", fontWeight: 800 }}>
              {provider} Dashboard
            </Typography>
            <Typography variant="body2" color="text.secondary">
              OAuth connection and compliance evaluation.
            </Typography>
          </Paper>

          <Paper elevation={0} sx={{ p: 3, border: "1px solid #d9e8f9" }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
              <Stack spacing={1}>
                <Typography variant="h6">Connection</Typography>
                <Chip
                  label={statusText}
                  color={connected ? "success" : "error"}
                  size="small"
                  sx={{ fontWeight: 700, width: "fit-content" }}
                />
              </Stack>
              <Button variant="outlined" onClick={handleDisconnect} sx={{ borderColor: "#0068D1", color: "#0068D1" }}>
                Logout
              </Button>
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ p: 3, border: "1px solid #d9e8f9" }}>
            <Typography variant="h6" sx={{ mb: 2 }}>Repository</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={8}>
                <FormControl fullWidth>
                  <InputLabel id="repo-select-label">Repo Selector</InputLabel>
                  <Select
                    labelId="repo-select-label"
                    multiple
                    value={selectedRepos}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSelectedRepos(typeof value === "string" ? value.split(",") : value);
                    }}
                    renderValue={(selected) => selected.length === 0 ? "Select repositories" : `${selected.length} selected`}
                    label="Repo Selector"
                    disabled={loadingRepos}
                  >
                    {availableRepos.map((name) => (
                      <MenuItem key={name} value={name}>
                        <Checkbox checked={selectedRepos.indexOf(name) > -1} />
                        <ListItemText primary={name} />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <Stack direction="row" spacing={1}>
                  <Button variant="outlined" onClick={() => setSelectedRepos(availableRepos)} disabled={availableRepos.length === 0}>
                    Select all
                  </Button>
                  <Button variant="outlined" onClick={() => setSelectedRepos([])} disabled={selectedRepos.length === 0}>
                    Clear
                  </Button>
                </Stack>
              </Grid>
            </Grid>
          </Paper>

          {hasRepo && (
            <Paper elevation={0} sx={{ p: 3, border: "1px solid #d9e8f9" }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Compliance</Typography>
              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <FormControl sx={{ minWidth: 220 }}>
                  <InputLabel id="compliance-label">Compliance</InputLabel>
                  <Select
                    labelId="compliance-label"
                    label="Compliance"
                    value={selectedCompliance}
                    onChange={(event) => setSelectedCompliance(event.target.value)}
                  >
                    <MenuItem value="">Select compliance</MenuItem>
                    <MenuItem value="iso27001">ISO 27001</MenuItem>
                    <MenuItem value="soc2">SOC 2</MenuItem>
                  </Select>
                </FormControl>
                <Button
                  variant="contained"
                  onClick={runCompliance}
                  disabled={running}
                  sx={{ bgcolor: "#0068D1", "&:hover": { bgcolor: "#0058b3" } }}
                >
                  {running ? "Running..." : "Run Compliance Test"}
                </Button>
              </Stack>
            </Paper>
          )}

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
                  <Tabs value={tab} onChange={(_event, value) => setTab(value)} textColor="primary" indicatorColor="primary">
                    <Tab label="By Questions" />
                    <Tab label="By Compliance" />
                  </Tabs>

                  {tab === 1 && (
                    <Grid container spacing={1.5}>
                      {Object.entries(summary).map(([key, count]) => (
                        <Grid item xs={6} md={3} key={key}>
                          <Card variant="outlined" sx={{ borderColor: "#d9e8f9" }}>
                            <CardContent sx={{ py: 1.5 }}>
                              <Typography variant="caption" color="text.secondary">{key.replaceAll("_", " ")}</Typography>
                              <Box mt={1}>{statusChip(key, `${count} item(s)`)} </Box>
                            </CardContent>
                          </Card>
                        </Grid>
                      ))}
                    </Grid>
                  )}

                  {tab === 0 && (
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Question</TableCell>
                            <TableCell>Control ID</TableCell>
                            <TableCell>Control Name</TableCell>
                            <TableCell>Control Component</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Result</TableCell>
                            <TableCell>Repository</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {rows.map((item, index) => {
                            const status = String(item?.status || "UNDETERMINED").toUpperCase();
                            const reason = String(item?.fail_reason || item?.findings || item?.answer || "").trim();
                            const resultText =
                              item?.compliant === true
                                ? "Compliant"
                                : item?.compliant === false
                                  ? "Not Compliant"
                                  : status === "COMPLIANT"
                                    ? "Compliant"
                                    : status === "NON_COMPLIANT"
                                      ? "Not Compliant"
                                      : "Undetermined";
                            return (
                              <TableRow key={`${item?.repository || "repo"}-${item?.control || "ctrl"}-${index}`}>
                                <TableCell>{String(item?.question || "-")}</TableCell>
                                <TableCell>{String(item?.control || "-")}</TableCell>
                                <TableCell>{String(item?.description || item?.control_name || "-")}</TableCell>
                                <TableCell>{String(item?.component || item?.control_component || item?.evidence_source || "-")}</TableCell>
                                <TableCell>{statusChip(status, reason)}</TableCell>
                                <TableCell>{resultText}</TableCell>
                                <TableCell>{String(item?.repository || result?.repository || "-")}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}

                  {tab === 1 && (
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Control ID</TableCell>
                            <TableCell>Control Name</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Result</TableCell>
                            <TableCell>Repository</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {rows.map((item, index) => {
                            const status = String(item?.status || "UNDETERMINED").toUpperCase();
                            const reason = String(item?.fail_reason || item?.findings || item?.answer || "").trim();
                            const resultText =
                              item?.compliant === true
                                ? "Compliant"
                                : item?.compliant === false
                                  ? "Not Compliant"
                                  : status === "COMPLIANT"
                                    ? "Compliant"
                                    : status === "NON_COMPLIANT"
                                      ? "Not Compliant"
                                      : "Undetermined";
                            return (
                              <TableRow key={`${item?.repository || "repo"}-${item?.control || "ctrl"}-${index}-c`}>
                                <TableCell>{String(item?.control || "-")}</TableCell>
                                <TableCell>{String(item?.description || item?.control_name || "-")}</TableCell>
                                <TableCell>{statusChip(status, reason)}</TableCell>
                                <TableCell>{resultText}</TableCell>
                                <TableCell>{String(item?.repository || result?.repository || "-")}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
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
