const { useEffect, useState } = React;
const {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  CssBaseline,
  Grid,
  Paper,
  Stack,
  ThemeProvider,
  Typography,
  createTheme
} = MaterialUI;

const providers = ["github", "gitlab", "bitbucket"];

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

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    return { connected: false };
  }
  return response.json();
}

function App() {
  const [statuses, setStatuses] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadStatuses() {
      setError("");
      try {
        const values = await Promise.all(
          providers.map(async (provider) => {
            const status = await api(`/api/auth/${provider}/status`);
            return { provider, connected: Boolean(status?.connected) };
          })
        );
        setStatuses(values);
      } catch (loadError) {
        setError(String(loadError));
      }
    }
    loadStatuses();
  }, []);

  function connect(provider) {
    window.location.href = `/api/auth/${provider}/connect`;
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="md" sx={{ py: 5 }}>
        <Stack spacing={2.5}>
          <Paper elevation={0} sx={{ p: 3, border: "1px solid #d9e8f9" }}>
            <Typography variant="h4" sx={{ color: "#0068D1", fontWeight: 800 }}>
              Change Evidence Report
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Select a version control and connect using OAuth.
            </Typography>
          </Paper>

          {error && <Alert severity="error">{error}</Alert>}

          <Paper elevation={0} sx={{ p: 3, border: "1px solid #d9e8f9" }}>
            <Typography variant="h6" sx={{ mb: 2 }}>Version Controls</Typography>
            <Grid container spacing={2}>
              {statuses.map((status) => (
                <Grid item xs={12} sm={6} md={4} key={status.provider}>
                  <Paper variant="outlined" sx={{ p: 2, borderColor: "#d9e8f9" }}>
                    <Stack spacing={1.25}>
                      <Typography sx={{ fontWeight: 700, textTransform: "capitalize" }}>
                        {status.provider}
                      </Typography>
                      <Chip
                        label={status.connected ? "Connected" : "Disconnected"}
                        color={status.connected ? "success" : "error"}
                        size="small"
                        sx={{ width: "fit-content", fontWeight: 700 }}
                      />
                      <Box>
                        <Button
                          variant="contained"
                          onClick={() => connect(status.provider)}
                          sx={{ bgcolor: "#0068D1", "&:hover": { bgcolor: "#0058b3" } }}
                        >
                          Connect
                        </Button>
                      </Box>
                    </Stack>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Paper>
        </Stack>
      </Container>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
