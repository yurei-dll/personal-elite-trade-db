(() => {
  const state = {
    currentSystemId: undefined,
    searchResults: [],
    searchToken: 0,
  };

  function select(selector) {
    return document.querySelector(selector);
  }

  function setStatus(message) {
    const status = select("[data-market-status]");

    if (status) {
      status.textContent = message;
    }
  }

  async function searchSystems(query) {
    const results = select("[data-market-system-results]");
    const token = state.searchToken + 1;

    state.searchToken = token;

    if (!(results instanceof HTMLDataListElement)) {
      return;
    }

    if (!query.trim()) {
      state.searchResults = [];
      results.replaceChildren();
      return;
    }

    const params = new URLSearchParams({ q: query.trim() });
    const response = await window.fetch("/dashboard/data/market-browser/system-search?" + params.toString(), {
      headers: {
        Accept: "application/json",
      },
    });

    if (token !== state.searchToken || !response.ok) {
      return;
    }

    const result = await response.json();
    state.searchResults = Array.isArray(result.systems) ? result.systems : [];
    results.replaceChildren(...state.searchResults.map((system) => {
      const option = document.createElement("option");
      option.value = system.name;
      option.label = system.name + " (" + formatNumber(system.x) + ", " + formatNumber(system.y) + ", " + formatNumber(system.z) + ")";
      return option;
    }));
  }

  async function loadSelectedSystem() {
    const input = select("[data-market-system-search]");

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const query = input.value.trim().toLowerCase();
    const match = state.searchResults.find((system) => system.name.toLowerCase() === query)
      ?? state.searchResults[0];

    if (!match) {
      setStatus("Search a system");
      renderEmpty("Search for a system first.");
      return;
    }

    input.value = match.name;
    await loadSystem(match.id);
  }

  async function loadSystem(systemId) {
    setStatus("Loading...");

    const params = new URLSearchParams({
      includeFleetCarriers: String(readMarketIncludeFleetCarriers()),
      includePlanetary: String(readMarketIncludePlanetary()),
    });
    const response = await window.fetch("/dashboard/data/market-browser/systems/" + encodeURIComponent(systemId) + "?" + params.toString(), {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      setStatus("Could not load");
      renderEmpty("Could not load market data for that system.");
      return;
    }

    state.currentSystemId = systemId;
    renderSystem(await response.json());
  }

  function renderSystem(result) {
    const system = result && typeof result.system === "object" ? result.system : undefined;
    const stations = Array.isArray(result?.markets) ? result.markets : [];
    const imported = Array.isArray(result?.commoditiesBought) ? result.commoditiesBought : [];
    const exported = Array.isArray(result?.commoditiesSold) ? result.commoditiesSold : [];

    if (!system) {
      setStatus("No data");
      renderEmpty("No market data found.");
      return;
    }

    const input = select("[data-market-system-search]");

    if (input instanceof HTMLInputElement) {
      input.value = system.name || "";
    }

    setStatus(formatNumber(stations.length) + " markets");
    renderSummary(system, stations.length, imported.length, exported.length);
    renderStations(stations);
    renderCommodities("[data-market-bought]", imported, "No imported commodities recorded.");
    renderCommodities("[data-market-sold]", exported, "No exported commodities recorded.");
  }

  function renderSummary(system, marketCount, importedCount, exportedCount) {
    const summary = select("[data-market-summary]");

    if (!summary) {
      return;
    }

    summary.replaceChildren(
      createElement("strong", {}, system.name || "Unknown system"),
      createSummaryActions(system),
      createElement("dl", {}, [
        createSummaryItem("Coordinates", [system.x, system.y, system.z].map(formatNumber).join(", ")),
        createSummaryItem("Markets", formatNumber(marketCount)),
        createSummaryItem("Imported", formatNumber(importedCount)),
        createSummaryItem("Exported", formatNumber(exportedCount)),
      ]),
    );
  }

  function createSummaryActions(system) {
    const actions = createElement("div", { className: "summary-actions" });
    const button = createElement("button", { className: "secondary icon-action-button" }, [
      createElement("span", { className: "action-sprite-icon" }),
      createElement("span", {}, "Use in planner"),
    ]);

    button.type = "button";
    button.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("petdb:use-system-in-planner", {
        detail: system,
      }));
    });
    actions.append(button);
    return actions;
  }

  function createSummaryItem(label, value) {
    const fragment = document.createDocumentFragment();
    fragment.append(
      createElement("dt", {}, label),
      createElement("dd", {}, value),
    );
    return fragment;
  }

  function renderStations(stations) {
    const body = select("[data-market-stations]");

    if (!body) {
      return;
    }

    if (stations.length === 0) {
      body.replaceChildren(createEmptyRow("No markets recorded for this system."));
      return;
    }

    body.replaceChildren(...stations.map((station) => {
      const row = document.createElement("tr");
      const stationLink = createElement("button", { className: "station-link" }, station.name || "Unknown");
      stationLink.type = "button";
      stationLink.addEventListener("click", () => {
        activateTab("station-browser");
        window.dispatchEvent(new CustomEvent("petdb:station-selected", {
          detail: {
            id: station.id,
            name: station.name,
          },
        }));
      });
      row.append(
        createElement("td", {}, stationLink),
        createElement("td", {}, station.type || "unknown"),
        createElement("td", {}, station.maxLandingPadSize || "unknown"),
        createElement("td", {}, typeof station.distanceToArrival === "number" ? formatNumber(station.distanceToArrival) + " ls" : "unknown"),
        createElement("td", {}, formatNumber(station.boughtCommodityCount || 0)),
        createElement("td", {}, formatNumber(station.soldCommodityCount || 0)),
        createElement("td", {}, formatDate(station.updatedAt)),
      );
      return row;
    }));
  }

  function renderCommodities(selector, commodities, emptyMessage) {
    const list = select(selector);

    if (!list) {
      return;
    }

    if (commodities.length === 0) {
      list.replaceChildren(createElement("li", { className: "muted" }, emptyMessage));
      return;
    }

    list.replaceChildren(...commodities.map((commodity) => {
      const category = commodity.category ? " | " + commodity.category : "";
      return createElement("li", {}, (commodity.name || commodity.id || "Unknown") + category);
    }));
  }

  function renderEmpty(message) {
    const summary = select("[data-market-summary]");
    const stations = select("[data-market-stations]");

    if (summary) {
      summary.replaceChildren(createElement("p", { className: "muted" }, message));
    }

    if (stations) {
      stations.replaceChildren(createEmptyRow(message));
    }

    renderCommodities("[data-market-bought]", [], "No imported commodities recorded.");
    renderCommodities("[data-market-sold]", [], "No exported commodities recorded.");
  }

  function readMarketIncludeFleetCarriers() {
    const input = select("[data-market-include-fleet-carriers]");

    return input instanceof HTMLInputElement && input.checked;
  }

  function readMarketIncludePlanetary() {
    const input = select("[data-market-include-planetary]");

    return input instanceof HTMLInputElement && input.checked;
  }

  function reloadCurrentSystem() {
    if (!state.currentSystemId) {
      return;
    }

    loadSystem(state.currentSystemId).catch(() => setStatus("Could not load"));
  }

  function createEmptyRow(message) {
    const cell = createElement("td", { className: "empty-table" }, message);
    cell.colSpan = 7;
    const row = document.createElement("tr");
    row.append(cell);
    return row;
  }

  function activateTab(tabName) {
    document.querySelectorAll("[data-dashboard-tab]").forEach((tab) => {
      const isActive = tab.getAttribute("data-dashboard-tab") === tabName;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-tab-panel") !== tabName;
    });
  }

  function createElement(tagName, options, children) {
    const element = document.createElement(tagName);

    if (options?.className) {
      element.className = options.className;
    }

    if (children !== undefined) {
      const childList = Array.isArray(children) ? children : [children];
      element.append(...childList);
    }

    return element;
  }

  function formatNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return "unknown";
    }

    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 1,
    }).format(number);
  }

  function formatDate(value) {
    if (!value) {
      return "unknown";
    }

    const date = new Date(value);

    if (Number.isNaN(date.valueOf())) {
      return "unknown";
    }

    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  window.addEventListener("DOMContentLoaded", () => {
    const input = select("[data-market-system-search]");
    const loadButton = select("[data-market-load]");
    const includeFleetCarriersInput = select("[data-market-include-fleet-carriers]");
    const includePlanetaryInput = select("[data-market-include-planetary]");
    let searchTimer = 0;

    if (input instanceof HTMLInputElement) {
      input.addEventListener("input", () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          searchSystems(input.value).catch(() => setStatus("Search failed"));
        }, 180);
      });
      input.addEventListener("change", () => {
        loadSelectedSystem().catch(() => setStatus("Could not load"));
      });
    }

    if (loadButton instanceof HTMLButtonElement) {
      loadButton.addEventListener("click", () => {
        loadSelectedSystem().catch(() => setStatus("Could not load"));
      });
    }

    [includeFleetCarriersInput, includePlanetaryInput].forEach((control) => {
      if (control instanceof HTMLInputElement) {
        control.addEventListener("change", reloadCurrentSystem);
      }
    });
  });

  window.addEventListener("petdb:system-selected", (event) => {
    const systemId = event.detail?.id;

    if (systemId) {
      loadSystem(systemId).catch(() => setStatus("Could not load"));
    }
  });
})();
