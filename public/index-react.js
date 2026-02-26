const { useEffect, useState } = React;
const {
  Alert,
  Box,
  Button,
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
const providerLogoMap = {
  github: "https://cdn.simpleicons.org/github/1f2937",
  gitlab: "https://cdn.simpleicons.org/gitlab/FC6D26",
  bitbucket: "https://cdn.simpleicons.org/bitbucket/0068D1"
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
      <Box sx={{ minHeight: "100vh", bgcolor: "#FFFFFF", display: "flex", alignItems: "center" }}>
        <Container maxWidth="lg" sx={{ py: 6 }}>
          <Stack spacing={4}>
            <Stack spacing={1} alignItems="center" textAlign="center">
              <Typography variant="h3" sx={{ color: "#0068D1", fontWeight: 800 }}>
                Connect Your Version Control
              </Typography>
              <Typography variant="body1" sx={{ color: "#4a6380" }}>
                Choose your preferred version control platform to get started
              </Typography>
            </Stack>

            {error && <Alert severity="error">{error}</Alert>}

            <Grid container spacing={3}>
              {statuses.map((status) => {
                const providerName = String(status.provider || "").toLowerCase();
                const details = providerName === "github"
                  ? "Connect your GitHub repositories to sync your projects and collaborate with your team."
                  : providerName === "gitlab"
                    ? "Integrate with GitLab for seamless CI/CD pipelines and project management."
                    : "Connect Bitbucket to manage your repositories with Atlassian's powerful tools.";
                const label = providerName === "github"
                  ? "Connect to GitHub"
                  : providerName === "gitlab"
                    ? "Connect to GitLab"
                    : "Connect to Bitbucket";

                return (
                  <Grid item xs={12} md={4} key={status.provider}>
                    <Paper
                      elevation={0}
                      sx={{
                        p: 3,
                        border: "1px solid #d7e6f7",
                        borderRadius: 3,
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        textAlign: "center",
                        gap: 2,
                        transition: "all 220ms ease",
                        "&:hover": {
                          borderColor: "#9cc7f0",
                          boxShadow: "0 10px 30px rgba(0, 104, 209, 0.12)",
                          transform: "translateY(-3px)"
                        }
                      }}
                    >
                      <Box
                        sx={{
                          width: 58,
                          height: 58,
                          borderRadius: 2,
                          bgcolor: "#f1f7ff",
                          border: "1px solid #d9e8f9",
                          display: "grid",
                          placeItems: "center"
                        }}
                      >
                        <Box
                          component="img"
                          src={providerLogoMap[providerName]}
                          alt={`${status.provider} logo`}
                          sx={{ width: 30, height: 30 }}
                        />
                      </Box>

                      <Typography variant="h5" sx={{ fontWeight: 800, color: "#0f172a", textTransform: "capitalize" }}>
                        {status.provider}
                      </Typography>

                      <Typography variant="body2" sx={{ color: "#4a6380", minHeight: 64 }}>
                        {details}
                      </Typography>

                      <Button
                        fullWidth
                        variant="contained"
                        onClick={() => connect(status.provider)}
                        sx={{
                          mt: "auto",
                          bgcolor: "#0068D1",
                          borderRadius: 2,
                          py: 1.1,
                          "&:hover": { bgcolor: "#0058b3" }
                        }}
                      >
                        {label}
                      </Button>
                    </Paper>
                  </Grid>
                );
              })}
            </Grid>
          </Stack>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
