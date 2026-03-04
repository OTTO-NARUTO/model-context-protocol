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
    primary: {
      main: "#1976d2", // A modern blue
      light: "#42a5f5",
      dark: "#1565c0",
      contrastText: "#fff",
    },
    secondary: {
      main: "#9c27b0", // A complementary purple
      light: "#ba68c8",
      dark: "#7b1fa2",
      contrastText: "#fff",
    },
    error: {
      main: "#d32f2f", // Standard error red
      light: "#ef5350",
      dark: "#c62828",
      contrastText: "#fff",
    },
    warning: {
      main: "#ff9800", // Standard warning orange
      light: "#ffb74d",
      dark: "#f57c00",
      contrastText: "rgba(0, 0, 0, 0.87)",
    },
    info: {
      main: "#0288d1", // Standard info blue
      light: "#29b6f6",
      dark: "#01579b",
      contrastText: "#fff",
    },
    success: {
      main: "#2e7d32", // Standard success green
      light: "#66bb6a",
      dark: "#1b5e20",
      contrastText: "#fff",
    },
    background: {
      default: "#f4f6f8", // Light gray background
      paper: "#FFFFFF", // White paper background
    },
  },
  typography: {
    fontFamily: "'Roboto', 'Helvetica', 'Arial', sans-serif",
    h4: {
      fontWeight: 700,
      fontSize: "2.125rem",
      lineHeight: 1.235,
      letterSpacing: "0.00735em",
    },
    h6: {
      fontWeight: 600,
      fontSize: "1.25rem",
      lineHeight: 1.6,
      letterSpacing: "0.0075em",
    },
    body1: {
      fontSize: "1rem",
      lineHeight: 1.5,
      letterSpacing: "0.00938em",
    },
    body2: {
      fontSize: "0.875rem",
      lineHeight: 1.43,
      letterSpacing: "0.01071em",
    },
    button: {
      textTransform: "none", // Prevent uppercase transformation
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 8, // Slightly less rounded corners for a modern feel
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          borderRadius: 8,
          boxShadow: "none", // Remove default shadow
          "&:hover": {
            boxShadow: "none", // Remove shadow on hover too
          },
        },
        containedPrimary: {
          "&:hover": {
            backgroundColor: "#1565c0", // Darker shade on hover for primary contained
          },
        },
        outlinedPrimary: {
          borderColor: "#d0d7e2",
          color: "#1976d2",
          "&:hover": {
            backgroundColor: "rgba(25, 118, 210, 0.04)", // Light hover effect
            borderColor: "#1976d2",
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          boxShadow: "0px 1px 3px rgba(0, 0, 0, 0.08)", // Subtle shadow for depth
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          boxShadow: "0px 1px 3px rgba(0, 0, 0, 0.08)",
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          borderRadius: 4,
        },
        filledSuccess: { backgroundColor: "#66bb6a" },
        filledError: { backgroundColor: "#ef5350" },
        filledWarning: { backgroundColor: "#ffb74d" },
        filledInfo: { backgroundColor: "#29b6f6" },
      },
    },
  },
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
              <Typography variant="h4" color="text.primary">
                Dashboard
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Manage your compliance scanning
              </Typography>
            </Stack>
            <Button variant="outlined" onClick={handleDisconnect} color="primary" sx={{ minWidth: 112 }}>
              Disconnect
            </Button>
          </Stack>

          <Paper elevation={0} sx={{ p: 2.5, border: "1px solid", borderColor: theme.palette.divider, borderRadius: theme.shape.borderRadius, transition: "border-color 0.3s ease-in-out" }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box sx={{ width: 24, height: 24, color: connected ? theme.palette.success.main : theme.palette.error.main }}>
                <svg stroke="currentColor" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Box>
              <Stack spacing={0.2}>
                <Typography variant="body1" sx={{ fontWeight: 700, color: theme.palette.text.primary }}>
                  {connected ? `Connected to ${provider.charAt(0).toUpperCase()}${provider.slice(1)}` : `Disconnected from ${provider}`}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {connected ? "Connection active and ready" : "Please connect to continue"}
                </Typography>
              </Stack>
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ p: 2.5, border: "1px solid #d8dee8", borderRadius: 2.5 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="h6" color="text.primary">Select Repositories</Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="outlined" onClick={() => setSelectedRepos(availableRepos)} disabled={availableRepos.length === 0}>Select All</Button>
                <Button size="small" variant="outlined" onClick={() => setSelectedRepos([])} disabled={selectedRepos.length === 0}>Clear</Button>
              </Stack>
            </Stack>

            {loadingRepos ? (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
                <CircularProgress size={18} color="primary" />
                <Typography variant="body2" color="text.secondary">Loading repositories...</Typography>
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
                        primary={<Typography sx={{ fontWeight: 700 }} color="text.primary">{name}</Typography>}
                        secondary={<Typography variant="body2" color="text.secondary">{repositoryHelperText(name)}</Typography>}
                      />
                    </ListItem>
                  );
                })}
              </List>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {selectedCount} of {availableRepos.length} repositories selected
            </Typography>
          </Paper>

          <Paper elevation={0} sx={{ p: 2.5, border: "1px solid #d8dee8", borderRadius: 2.5 }}>
            <Typography variant="h6" color="text.primary" sx={{ mb: 2 }}>Select Compliance Standard</Typography>
            <Grid container spacing={1.5}>
              <Grid item xs={12} md={12}>
                <Button
                  fullWidth
                  variant={selectedCompliance === "iso27001" ? "contained" : "outlined"}
                  onClick={() => setSelectedCompliance("iso27001")}
                  color="primary"
                  sx={{
                    justifyContent: "flex-start",
                    py: 1.2,
                    borderColor: selectedCompliance === "iso27001" ? "none" : theme.palette.divider,
                    "&:hover": {
                      borderColor: selectedCompliance === "iso27001" ? "none" : theme.palette.primary.light,
                      backgroundColor: selectedCompliance === "iso27001" ? theme.palette.primary.dark : theme.palette.action.hover,
                    }
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
              color="primary"
              sx={{ px: 3, py: 1.1 }}
            >
              {running ? "Running..." : "Run Compliance Check"}
            </Button>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}

          {(running || result) && (
            <Paper elevation={0} sx={{ p: 3, border: "1px solid", borderColor: theme.palette.divider, borderRadius: theme.shape.borderRadius }}>
              <Typography variant="h6" color="text.primary" sx={{ mb: 2 }}>Test Result</Typography>
              {running && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={20} color="primary" />
                  <Typography variant="body2" color="text.secondary">One moment please...</Typography>
                </Stack>
              )}

              {!running && rows.length > 0 && (
                <Stack spacing={2}>
                  <Grid container spacing={1.5}>
                    {Object.entries(summary).map(([key, count]) => (
                      <Grid item xs={6} md={3} key={key}>
                        <Card variant="outlined" sx={{ borderColor: theme.palette.divider }}>
                          <CardContent sx={{ py: 1.5 }}>
                            <Typography variant="caption" color="text.secondary">{key.replaceAll("_", " ")}</Typography>
                            <Typography
                              variant="h5"
                              sx={{ mt: 0.75, fontWeight: 800 }} color="text.primary"
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
                          <TableCell sx={{ fontWeight: 700, color: theme.palette.text.primary }}>Control ID</TableCell>
                          <TableCell sx={{ fontWeight: 700, color: theme.palette.text.primary }}>Control Name</TableCell>
                          <TableCell sx={{ fontWeight: 700, color: theme.palette.text.primary }}>Status</TableCell>
                          <TableCell sx={{ fontWeight: 700, color: theme.palette.text.primary }}>API Call Reason</TableCell>
                          <TableCell sx={{ fontWeight: 700, color: theme.palette.text.primary }}>Status Reason</TableCell>
                          <TableCell sx={{ fontWeight: 700, color: theme.palette.text.primary }}>Repository</TableCell>
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
