const providers = ["github", "gitlab", "bitbucket"];
const providerCards = document.getElementById("providerCards");

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options
  });
  if (!response.ok) {
    return { connected: false };
  }
  return response.json();
}

async function refreshProviderCards() {
  const statuses = await Promise.all(
    providers.map(async (provider) => {
      const status = await api(`/api/auth/${provider}/status`);
      return { provider, connected: Boolean(status.connected) };
    })
  );

  providerCards.innerHTML = statuses
    .map(
      (status) => `
      <article class="card">
        <strong>${status.provider}</strong>
        <span class="status-pill ${status.connected ? "connected" : "disconnected"}">
          ${status.connected ? "Connected" : "Disconnected"}
        </span>
        <button data-connect="${status.provider}">Connect</button>
      </article>
    `
    )
    .join("");
}

providerCards.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const provider = target.dataset.connect;
  if (!provider) {
    return;
  }
  window.location.href = `/api/auth/${provider}/connect`;
});

refreshProviderCards();
