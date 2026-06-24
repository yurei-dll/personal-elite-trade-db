import type {
  DashboardHealth,
  DashboardSession,
  DashboardStats,
} from "./types";

const ADMIN_MAX_AGE_SECONDS = 60 * 10;

export function renderLoginPage(errorMessage?: string): string {
  return renderDocument({
    body: `
      <main class="login-shell">
        <section class="login-panel">
          <p class="eyebrow">personal-elite-trade-db</p>
          <h1>Dashboard Login</h1>
          <p class="muted">Read-only access to local trade database status.</p>
          ${errorMessage ? `<p class="alert">${escapeHtml(errorMessage)}</p>` : ""}
          <form method="post" action="/dashboard/login" class="stack">
            <label>
              <span>Password</span>
              <input type="password" name="password" autocomplete="current-password" autofocus required>
            </label>
            <button type="submit">Enter dashboard</button>
          </form>
        </section>
      </main>
    `,
    title: "Dashboard Login",
  });
}

export function renderDashboardPage(options: {
  readonly adminMessage?: string;
  readonly health: DashboardHealth;
  readonly session: DashboardSession;
  readonly stats: DashboardStats;
}): string {
  return renderDocument({
    body: `
      <header class="topbar">
        <div>
          <p class="eyebrow">Elite: Dangerous trade database</p>
          <h1>Command Dashboard</h1>
        </div>
        <div class="topbar-controls">
          <label class="select-field">
            <span>Update rate</span>
            <select data-refresh-rate>
              <option value="5">5 seconds</option>
              <option value="15">15 seconds</option>
              <option value="30">30 seconds</option>
              <option value="60">1 minute</option>
              <option value="300">5 minutes</option>
              <option value="0">Manual</option>
            </select>
          </label>
          <form method="post" action="/dashboard/logout">
            <button type="submit" class="secondary">Log out</button>
          </form>
        </div>
      </header>
      <main class="dashboard-grid">
        ${renderSummarySection(options.stats)}
        ${renderHealthSection(options.health)}
        ${renderAdminSection(options.session, options.adminMessage)}
      </main>
      <script src="/dashboard/assets/htmx.min.js"></script>
      <script src="/dashboard/assets/dashboard.js"></script>
    `,
    title: "Command Dashboard",
  });
}

export function renderSummarySection(stats: DashboardStats): string {
  return `
    <section id="summary" class="section wide">
      <div class="section-header">
        <div>
          <p class="eyebrow">Database</p>
          <h2>Trade Data</h2>
        </div>
        <span class="pill" data-refresh-label>auto-refresh 30s</span>
      </div>
      <div class="metric-grid">
        ${renderMetric("Systems", stats.systems)}
        ${renderMetric("Stations", stats.stations)}
        ${renderMetric("Commodities", stats.commodities)}
        ${renderMetric("Market rows", stats.marketRows)}
        ${renderMetric("Database size", formatBytes(stats.databaseSizeBytes))}
      </div>
      <div class="freshness">
        <p><span>Latest collected</span>${formatDate(stats.latestCollectedAt)}</p>
        <p><span>Latest received</span>${formatDate(stats.latestReceivedAt)}</p>
        <p><span>Stale market rows</span>${formatNumber(stats.staleMarketRows)}</p>
      </div>
    </section>
  `;
}

function renderHealthSection(health: DashboardHealth): string {
  return `
    <section class="section">
      <div class="section-header">
        <div>
          <p class="eyebrow">Server</p>
          <h2>Health</h2>
        </div>
        <span class="status ${health.connected ? "ok" : "error"}">
          ${health.connected ? "connected" : "offline"}
        </span>
      </div>
      <p class="muted">
        ${health.connectionMilliseconds === undefined
          ? "No successful connection timing yet."
          : `Connected in ${escapeHtml(String(health.connectionMilliseconds))} ms.`}
      </p>
      ${health.error ? `<p class="alert">${escapeHtml(health.error)}</p>` : ""}
      <div class="check-list">
        ${health.checks.map(renderHealthCheck).join("")}
      </div>
    </section>
  `;
}

function renderAdminSection(
  session: DashboardSession,
  message: string | undefined,
): string {
  const isAdmin = session.role === "admin";

  return `
    <section class="section">
      <div class="section-header">
        <div>
          <p class="eyebrow">Access</p>
          <h2>Admin Elevation</h2>
        </div>
        <span class="status ${isAdmin ? "ok" : "warning"}">
          ${isAdmin ? "admin" : "read-only"}
        </span>
      </div>
      <p class="muted">
        Admin elevation lasts for ${Math.round(ADMIN_MAX_AGE_SECONDS / 60)} minutes and is reserved for destructive actions.
      </p>
      ${message ? `<p class="alert">${escapeHtml(message)}</p>` : ""}
      <form method="post" action="/dashboard/admin/elevate" class="stack">
        <label>
          <span>Admin password</span>
          <input type="password" name="password" autocomplete="current-password" required>
        </label>
        <button type="submit" ${isAdmin ? "disabled" : ""}>Elevate</button>
      </form>
    </section>
  `;
}

function renderMetric(label: string, value: number | string | undefined): string {
  return `
    <article class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${formatMetricValue(value)}</strong>
    </article>
  `;
}

function renderHealthCheck(check: DashboardHealth["checks"][number]): string {
  return `
    <article class="check">
      <span class="status ${check.status}">${escapeHtml(check.status)}</span>
      <div>
        <strong>${escapeHtml(check.name)}</strong>
        <p>${escapeHtml(check.message)}</p>
      </div>
    </article>
  `;
}

function renderDocument(options: {
  readonly body: string;
  readonly title: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(options.title)} - personal-elite-trade-db</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #08090d;
        --panel: #11141c;
        --panel-strong: #181d29;
        --text: #f4f7fb;
        --muted: #9aa7b8;
        --line: #263142;
        --accent: #48d7ff;
        --accent-strong: #7bf2c4;
        --danger: #ff6b7a;
        --warning: #f6c95f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: radial-gradient(circle at top left, #182033 0, #08090d 38rem);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      h1, h2, p { margin: 0; }
      h1 { font-size: clamp(2rem, 5vw, 4.5rem); line-height: 1; }
      h2 { font-size: 1.2rem; }
      button, input, select {
        border: 1px solid var(--line);
        border-radius: 8px;
        color: var(--text);
        font: inherit;
      }
      button {
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        color: #071014;
        cursor: pointer;
        font-weight: 800;
        padding: 0.8rem 1rem;
      }
      button.secondary {
        background: var(--panel-strong);
        color: var(--text);
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      input {
        background: #090c12;
        margin-top: 0.45rem;
        padding: 0.75rem 0.85rem;
        width: 100%;
      }
      select {
        appearance: none;
        background: #090c12;
        cursor: pointer;
        margin-top: 0.45rem;
        min-width: 9rem;
        padding: 0.7rem 2rem 0.7rem 0.85rem;
      }
      label span {
        color: var(--muted);
        display: block;
        font-size: 0.9rem;
      }
      .login-shell {
        display: grid;
        min-height: 100vh;
        padding: 1.25rem;
        place-items: center;
      }
      .login-panel {
        background: rgba(17, 20, 28, 0.92);
        border: 1px solid var(--line);
        border-radius: 8px;
        max-width: 28rem;
        padding: 2rem;
        width: min(100%, 28rem);
      }
      .topbar {
        align-items: end;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
        padding: 2rem;
      }
      .topbar-controls {
        align-items: end;
        display: flex;
        gap: 0.75rem;
      }
      .select-field {
        position: relative;
      }
      .select-field::after {
        color: var(--muted);
        content: "v";
        font-size: 0.75rem;
        pointer-events: none;
        position: absolute;
        right: 0.8rem;
        top: 2.35rem;
      }
      .dashboard-grid {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        padding: 0 2rem 2rem;
      }
      .section {
        background: rgba(17, 20, 28, 0.9);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 1.1rem;
      }
      .wide { grid-column: 1 / -1; }
      .section-header {
        align-items: start;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
        margin-bottom: 1rem;
      }
      .eyebrow {
        color: var(--accent);
        font-size: 0.76rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .muted {
        color: var(--muted);
        margin-top: 0.45rem;
      }
      .alert {
        background: rgba(255, 107, 122, 0.12);
        border: 1px solid rgba(255, 107, 122, 0.4);
        border-radius: 8px;
        color: #ffd3d8;
        margin: 1rem 0;
        padding: 0.75rem;
      }
      .stack {
        display: grid;
        gap: 1rem;
        margin-top: 1.2rem;
      }
      .metric-grid {
        display: grid;
        gap: 0.8rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      .metric {
        background: var(--panel-strong);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 1rem;
      }
      .metric span, .freshness span {
        color: var(--muted);
        display: block;
        font-size: 0.82rem;
      }
      .metric strong {
        display: block;
        font-size: clamp(1.5rem, 4vw, 2.7rem);
        margin-top: 0.25rem;
      }
      .freshness {
        display: grid;
        gap: 0.8rem;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin-top: 0.9rem;
      }
      .freshness p {
        border-left: 3px solid var(--accent);
        color: var(--text);
        padding-left: 0.75rem;
      }
      .pill, .status {
        border-radius: 999px;
        border: 1px solid var(--line);
        color: var(--muted);
        font-size: 0.78rem;
        font-weight: 800;
        padding: 0.25rem 0.55rem;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .status.ok { color: var(--accent-strong); }
      .status.warning { color: var(--warning); }
      .status.error { color: var(--danger); }
      .check-list {
        display: grid;
        gap: 0.75rem;
        margin-top: 1rem;
      }
      .check {
        align-items: start;
        display: flex;
        gap: 0.75rem;
      }
      .check p {
        color: var(--muted);
        font-size: 0.9rem;
        margin-top: 0.2rem;
        white-space: pre-wrap;
      }
      @media (max-width: 760px) {
        .topbar {
          align-items: stretch;
          flex-direction: column;
          padding: 1rem;
        }
        .topbar-controls {
          align-items: stretch;
          flex-direction: column;
        }
        .dashboard-grid {
          grid-template-columns: 1fr;
          padding: 0 1rem 1rem;
        }
        .metric-grid, .freshness {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>${options.body}</body>
</html>`;
}

function formatMetricValue(value: number | string | undefined): string {
  return typeof value === "number" ? formatNumber(value) : escapeHtml(value ?? "unknown");
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? "unknown" : new Intl.NumberFormat("en-US").format(value);
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) {
    return "unknown";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let scaledValue = value;

  while (scaledValue >= 1024 && unitIndex < units.length - 1) {
    scaledValue /= 1024;
    unitIndex += 1;
  }

  const maximumFractionDigits = unitIndex === 0 ? 0 : 1;

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(scaledValue)} ${units[unitIndex]}`;
}

function formatDate(value: Date | undefined): string {
  if (!value) {
    return "unknown";
  }

  return escapeHtml(
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value),
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}
