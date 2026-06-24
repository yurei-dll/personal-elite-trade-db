import { readFileSync } from "node:fs";

export const HTMX_SCRIPT = readFileSync(
  require.resolve("htmx.org/dist/htmx.min.js"),
  "utf8",
);

export const DASHBOARD_SCRIPT = `
(() => {
  const storageKey = "petdb.dashboard.refreshSeconds";
  const defaultRefreshSeconds = "30";
  let refreshTimer;

  function readRefreshSeconds(select) {
    const storedValue = window.localStorage.getItem(storageKey);

    if (storedValue && select.querySelector(\`option[value="\${storedValue}"]\`)) {
      return storedValue;
    }

    return defaultRefreshSeconds;
  }

  function updateRefreshLabel(value) {
    const label = document.querySelector("[data-refresh-label]");

    if (!label) {
      return;
    }

    label.textContent = value === "0" ? "manual refresh" : \`auto-refresh \${value}s\`;
  }

  function refreshSummary() {
    const summary = document.querySelector("#summary");

    if (!summary || !window.htmx) {
      return;
    }

    window.htmx.ajax("GET", "/dashboard/partials/summary", {
      swap: "outerHTML",
      target: "#summary",
    });
  }

  function applyRefreshRate(value) {
    window.localStorage.setItem(storageKey, value);
    window.clearInterval(refreshTimer);
    updateRefreshLabel(value);

    const seconds = Number.parseInt(value, 10);

    if (Number.isFinite(seconds) && seconds > 0) {
      refreshTimer = window.setInterval(refreshSummary, seconds * 1000);
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    const select = document.querySelector("[data-refresh-rate]");

    if (!select) {
      return;
    }

    select.value = readRefreshSeconds(select);
    applyRefreshRate(select.value);
    select.addEventListener("change", () => applyRefreshRate(select.value));
  });
})();
`;
