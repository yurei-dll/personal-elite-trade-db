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
      <nav class="tabs" aria-label="Dashboard sections">
        <button class="tab active" type="button" data-dashboard-tab="dashboard" aria-selected="true">Dashboard</button>
        <button class="tab" type="button" data-dashboard-tab="route-planner" aria-selected="false">Route planner</button>
        <button class="tab" type="button" data-dashboard-tab="galaxy-map" aria-selected="false">Galaxy map</button>
        <button class="tab" type="button" data-dashboard-tab="market-browser" aria-selected="false">System Browser</button>
        <button class="tab" type="button" data-dashboard-tab="station-browser" aria-selected="false">Station Browser</button>
      </nav>
      <main>
        <section class="dashboard-grid" data-tab-panel="dashboard" aria-labelledby="dashboard-tab-title">
          <h2 id="dashboard-tab-title" class="visually-hidden">Dashboard</h2>
          ${renderSummarySection(options.stats)}
          ${renderInboundMessagesSection()}
          ${renderHealthSection(options.health)}
          ${renderAdminSection(options.session, options.adminMessage)}
        </section>
        ${renderRoutePlannerSection()}
        ${renderGalaxyMapSection()}
        ${renderMarketBrowserSection()}
        ${renderStationBrowserSection()}
      </main>
      <script src="/dashboard/assets/htmx.min.js"></script>
      <script src="/dashboard/assets/dashboard.js"></script>
      <script src="/dashboard/assets/route-planner.js"></script>
      <script src="/dashboard/assets/market-browser.js"></script>
      <script src="/dashboard/assets/station-browser.js"></script>
    `,
    title: "Command Dashboard",
  });
}

export function renderSummarySection(
  stats: DashboardStats,
  refreshSeconds = "30",
): string {
  return `
    <section id="summary" class="section wide">
      <div class="section-header">
        <div>
          <p class="eyebrow">Database</p>
          <h2>Trade Data</h2>
        </div>
        <span class="pill" data-refresh-label>${formatRefreshLabel(refreshSeconds)}</span>
      </div>
      <div class="metric-grid">
        ${renderMetric("Systems", stats.systems)}
        ${renderMetric("Stations", stats.stations)}
        ${renderMetric("Commodities", stats.commodities)}
        ${renderMetric("Market rows", stats.marketRows)}
        ${renderMetric("Stale market rows", stats.staleMarketRows)}
        ${renderMetric("Database size", formatBytes(stats.databaseSizeBytes))}
      </div>
      <div class="freshness">
        <p><span>Last collected</span>${formatDate(stats.latestCollectedAt)}</p>
        <p><span>Last received</span>${formatDate(stats.latestReceivedAt)}</p>
        <p><span>Last patch</span>${formatDate(stats.lastPatchAt)}</p>
      </div>
    </section>
  `;
}

function formatRefreshLabel(value: string): string {
  return value === "0"
    ? "manual refresh"
    : `auto-refresh ${escapeHtml(value)}s`;
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

function renderInboundMessagesSection(): string {
  return `
    <section class="section wide">
      <div class="section-header">
        <div>
          <p class="eyebrow">EDDN</p>
          <h2>Inbound Messages</h2>
        </div>
        <span class="pill" data-inbound-total>0 in 60m</span>
      </div>
      <div class="chart-shell">
        <canvas data-inbound-chart height="180" aria-label="Inbound EDDN messages over time"></canvas>
      </div>
      <p class="muted" data-inbound-empty>No inbound messages recorded in this dashboard process yet.</p>
    </section>
  `;
}

function renderRoutePlannerSection(): string {
  return `
    <section class="route-planner" data-tab-panel="route-planner" aria-labelledby="route-planner-tab-title" hidden>
      <div class="section planner-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">Route Planner</p>
            <h2 id="route-planner-tab-title">Jump Timeline</h2>
          </div>
          <span class="pill" data-planner-status>Choose pickup</span>
        </div>
        <div class="planner-loading-overlay" data-planner-loading hidden>
          <span class="planner-loading-icon" aria-hidden="true"></span>
          <strong>Building route</strong>
        </div>
        <div class="planner-layout">
          <div class="planner-timeline" data-planner-timeline>
            <div class="timeline-node endpoint">
              <span class="timeline-dot"></span>
              <strong>Pickup</strong>
              <small data-planner-pickup-label>Select system</small>
              <span class="timeline-cash-badge loss" data-planner-source-cash hidden></span>
              <span class="planetary-badge" data-planner-source-planetary hidden>Planetary</span>
              <div class="timeline-actions">
                <button type="button" class="timeline-copy" data-planner-copy-source disabled>Copy market</button>
                <button type="button" class="timeline-copy" data-planner-view-source disabled>View market</button>
              </div>
            </div>
            <div class="timeline-track" data-planner-track>
              <p class="muted">Select a pickup system and commodity, then build a route.</p>
            </div>
            <div class="timeline-node endpoint">
              <span class="timeline-dot"></span>
              <strong>Buyer</strong>
              <small data-planner-buyer-label>Best match</small>
              <span class="timeline-cash-badge gain" data-planner-destination-cash hidden></span>
              <span class="planetary-badge" data-planner-destination-planetary hidden>Planetary</span>
              <div class="timeline-actions">
                <button type="button" class="timeline-copy" data-planner-copy-destination disabled>Copy market</button>
                <button type="button" class="timeline-copy" data-planner-view-destination disabled>View market</button>
              </div>
            </div>
          </div>
          <div class="planner-loop-center">
            <div class="cycle-turn cycle-turn-left" aria-hidden="true">↑</div>
            <div class="planner-center-panel">
              <aside class="planner-controls">
                <div class="planner-endpoints">
                  <label>
                    <span>Pickup location</span>
                    <input type="search" list="planner-pickup-results" placeholder="Search systems..." autocomplete="off" data-planner-pickup-search>
                    <datalist id="planner-pickup-results" data-planner-pickup-results></datalist>
                  </label>
                  <label>
                    <span>Commodity</span>
                    <select data-planner-commodity disabled>
                      <option value="">Choose pickup first</option>
                    </select>
                  </label>
                  <button type="button" class="secondary planner-use-best" data-planner-use-best disabled>Use best</button>
                </div>
                <div class="planner-settings">
                  <label>
                    <span>Cargo space</span>
                    <input type="number" min="1" max="100000" step="1" value="100" data-planner-cargo-space>
                  </label>
                  <label>
                    <span>Max jump range</span>
                    <input type="number" min="1" max="500" step="0.1" value="30" data-planner-max-range>
                  </label>
                  <label>
                    <span>Max jumps</span>
                    <input type="number" min="1" max="100" step="1" value="8" data-planner-max-jumps>
                  </label>
                  <label>
                    <span>Min landing pad size</span>
                    <select data-planner-pad-size>
                      <option value="M">Medium</option>
                      <option value="L" selected>Large</option>
                    </select>
                  </label>
                  <label class="toggle-field">
                    <input type="checkbox" data-planner-include-fleet-carriers>
                    <span>Include fleet carriers</span>
                  </label>
                  <label class="toggle-field">
                    <input type="checkbox" data-planner-include-planetary>
                    <span>Include planetary settlements</span>
                  </label>
                  <label class="toggle-field">
                    <input type="checkbox" data-planner-require-destination-demand>
                    <span>Require buyer demand</span>
                  </label>
                </div>
                <div class="planner-command-row">
                  <button type="button" data-planner-build>Build route</button>
                  <button type="button" class="secondary" data-planner-view-route disabled>View route</button>
                </div>
              </aside>
            </div>
            <div class="cycle-turn cycle-turn-right" aria-hidden="true">↓</div>
          </div>
          <section class="planner-timeline planner-return-timeline">
            <div class="timeline-node endpoint">
              <span class="timeline-dot"></span>
              <strong>Pickup</strong>
              <small data-planner-return-end-label>Pickup system</small>
              <span class="timeline-cash-badge gain" data-planner-return-destination-cash hidden></span>
            </div>
            <div class="timeline-track" data-planner-return-track>
              <p class="muted">Return haul appears after a route is built.</p>
            </div>
            <div class="timeline-node endpoint">
              <span class="timeline-dot"></span>
              <strong>Return commodity</strong>
              <small data-planner-return-start-label>Buyer system</small>
              <span class="timeline-cash-badge loss" data-planner-return-source-cash hidden></span>
            </div>
          </section>
        </div>
      </div>
    </section>
  `;
}

function renderGalaxyMapSection(): string {
  return `
    <section class="galaxy-map" data-tab-panel="galaxy-map" aria-labelledby="galaxy-map-tab-title" hidden>
      <div class="section route-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">Galaxy Map</p>
            <h2 id="galaxy-map-tab-title" data-route-map-title>Nearby Systems Map</h2>
          </div>
          <span class="pill">Interactive map</span>
        </div>
        <div class="route-layout">
          <aside class="route-controls">
            <section class="route-selection-panel" aria-live="polite">
              <div>
                <span class="mini-label">Selected system</span>
                <strong data-route-selection-name>No system selected</strong>
              </div>
              <dl>
                <div>
                  <dt>Coordinates</dt>
                  <dd data-route-selection-coordinates>--</dd>
                </div>
                <div>
                  <dt>Reference distance</dt>
                  <dd data-route-selection-distance>--</dd>
                </div>
              </dl>
              <button type="button" class="secondary" data-route-open-selected disabled>Open in new tab</button>
            </section>
            <div class="route-control-grid">
              <label>
                <span>System count</span>
                <select data-route-limit>
                  <option value="50">50 systems</option>
                  <option value="100" selected>100 systems</option>
                  <option value="250">250 systems</option>
                  <option value="500">500 systems</option>
                </select>
              </label>
              <label class="wide-field">
                <span>Reference system</span>
                <input type="search" list="route-reference-results" placeholder="Search systems..." autocomplete="off" data-route-reference-search>
                <datalist id="route-reference-results" data-route-reference-results></datalist>
              </label>
            </div>
            <input type="hidden" value="0" data-route-origin-x>
            <input type="hidden" value="0" data-route-origin-y>
            <input type="hidden" value="0" data-route-origin-z>
            <button type="button" class="secondary" data-route-set-reference>Set reference</button>
            <p class="route-reference" data-route-reference>Reference: galactic origin</p>
            <button type="button" class="secondary" data-route-load disabled>Load nearest systems</button>
            <p class="muted" data-route-status>Loading 3D map...</p>
          </aside>
          <div class="route-map-frame">
            <div class="route-view-banner" data-route-view-banner hidden>
              <strong>Route view</strong>
              <button type="button" class="route-exit-button" data-route-exit-view>Exit route view</button>
            </div>
            <canvas data-route-canvas hidden aria-label="3D view of nearby systems"></canvas>
            <div class="route-hover-label" data-route-hover hidden></div>
            <div class="route-map-placeholder">Loading 3D map...</div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderMarketBrowserSection(): string {
  return `
    <section class="market-browser" data-tab-panel="market-browser" aria-labelledby="market-browser-tab-title" hidden>
      <div class="section market-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">System Browser</p>
            <h2 id="market-browser-tab-title">System Markets</h2>
          </div>
          <span class="pill" data-market-status>Search a system</span>
        </div>
        <div class="market-search-row">
          <label>
            <span>System</span>
            <input type="search" list="market-system-results" placeholder="Search systems..." autocomplete="off" data-market-system-search>
            <datalist id="market-system-results" data-market-system-results></datalist>
          </label>
          <button type="button" class="secondary" data-market-load>Load markets</button>
        </div>
        <div class="market-summary" data-market-summary>
          <p class="muted">Select a system to see its markets and the unique commodities imported and exported there.</p>
        </div>
        <div class="market-layout">
          <section class="market-panel">
            <div class="market-panel-header">
              <h3>Markets</h3>
              <div class="market-filter-row">
                <label class="toggle-field">
                  <input type="checkbox" data-market-include-fleet-carriers>
                  <span>Include fleet carriers</span>
                </label>
                <label class="toggle-field">
                  <input type="checkbox" data-market-include-planetary>
                  <span>Include planetary ports</span>
                </label>
              </div>
            </div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Station</th>
                    <th>Type</th>
                    <th>Pad</th>
                    <th>Arrival</th>
                    <th>Imported</th>
                    <th>Exported</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody data-market-stations>
                  <tr><td colspan="7" class="empty-table">No system selected.</td></tr>
                </tbody>
              </table>
            </div>
          </section>
          <section class="market-panel">
            <h3>Unique Commodities Imported</h3>
            <ul class="commodity-list" data-market-bought>
              <li class="muted">No system selected.</li>
            </ul>
          </section>
          <section class="market-panel">
            <h3>Unique Commodities Exported</h3>
            <ul class="commodity-list" data-market-sold>
              <li class="muted">No system selected.</li>
            </ul>
          </section>
        </div>
      </div>
    </section>
  `;
}

function renderStationBrowserSection(): string {
  return `
    <section class="station-browser" data-tab-panel="station-browser" aria-labelledby="station-browser-tab-title" hidden>
      <div class="section market-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">Station Browser</p>
            <h2 id="station-browser-tab-title">Station Detail</h2>
          </div>
          <span class="pill" data-station-status>Search a station</span>
        </div>
        <div class="market-search-row">
          <label>
            <span>Station</span>
            <input type="search" list="station-search-results" placeholder="Search stations..." autocomplete="off" data-station-search>
            <datalist id="station-search-results" data-station-results></datalist>
          </label>
          <button type="button" class="secondary" data-station-load>Load station</button>
        </div>
        <div class="market-summary" data-station-summary>
          <p class="muted">Select a station from search or jump here from the System Browser.</p>
        </div>
        <section class="market-panel">
          <h3>Station Commodities</h3>
          <div class="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Commodity</th>
                  <th>Category</th>
                  <th>Buys For</th>
                  <th>Sells For</th>
                  <th>Demand</th>
                  <th>Stock</th>
                  <th>Collected</th>
                </tr>
              </thead>
              <tbody data-station-commodities>
                <tr><td colspan="7" class="empty-table">No station selected.</td></tr>
              </tbody>
            </table>
          </div>
        </section>
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
    <link rel="stylesheet" href="/dashboard/assets/styles.css">
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
