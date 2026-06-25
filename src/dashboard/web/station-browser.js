(() => {
  const state = {
    searchResults: [],
    searchToken: 0,
  };

  function select(selector) {
    return document.querySelector(selector);
  }

  function setStatus(message) {
    const status = select("[data-station-status]");

    if (status) {
      status.textContent = message;
    }
  }

  async function searchStations(query) {
    const results = select("[data-station-results]");
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
    const response = await window.fetch("/dashboard/data/station-browser/station-search?" + params.toString(), {
      headers: {
        Accept: "application/json",
      },
    });

    if (token !== state.searchToken || !response.ok) {
      return;
    }

    const result = await response.json();
    state.searchResults = Array.isArray(result.stations) ? result.stations : [];
    results.replaceChildren(...state.searchResults.map((station) => {
      const option = document.createElement("option");
      option.value = formatStationDisplayName(station);
      return option;
    }));
  }

  async function loadSelectedStation() {
    const input = select("[data-station-search]");

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const query = input.value.trim().toLowerCase();
    const match = state.searchResults.find((station) => {
      return station.name.toLowerCase() === query
        || formatStationDisplayName(station).toLowerCase() === query;
    })
      ?? state.searchResults[0];

    if (!match) {
      setStatus("Search a station");
      renderEmpty("Search for a station first.");
      return;
    }

    input.value = match.name;
    await loadStation(match.id);
  }

  async function loadStation(stationId) {
    setStatus("Loading...");

    const response = await window.fetch("/dashboard/data/station-browser/stations/" + encodeURIComponent(stationId), {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      setStatus("Could not load");
      renderEmpty("Could not load station data.");
      return;
    }

    renderStation(await response.json());
  }

  function renderStation(result) {
    const station = result && typeof result.station === "object" ? result.station : undefined;
    const commodities = Array.isArray(result?.commodities) ? result.commodities : [];

    if (!station) {
      setStatus("No data");
      renderEmpty("No station data found.");
      return;
    }

    const input = select("[data-station-search]");

    if (input instanceof HTMLInputElement) {
      input.value = station.name || "";
    }

    setStatus(formatNumber(commodities.length) + " commodities");
    renderSummary(station, commodities.length);
    renderCommodities(commodities);
  }

  function renderSummary(station, commodityCount) {
    const summary = select("[data-station-summary]");

    if (!summary) {
      return;
    }

    summary.replaceChildren(
      createElement("strong", {}, station.name || "Unknown station"),
      createSummaryActions(station),
      createElement("dl", {}, [
        createSummaryItem("System", station.systemName || "unknown"),
        createSummaryItem("Type", station.type || "unknown"),
        createSummaryItem("Pad", station.maxLandingPadSize || "unknown"),
        createSummaryItem("Arrival", typeof station.distanceToArrival === "number" ? formatNumber(station.distanceToArrival) + " ls" : "unknown"),
        createSummaryItem("Market", station.hasMarket ? "yes" : "no"),
        createSummaryItem("Commodities", formatNumber(commodityCount)),
        createSummaryItem("Updated", formatDate(station.updatedAt)),
      ]),
    );
  }

  function createSummaryActions(station) {
    const actions = createElement("div", { className: "summary-actions" });
    const button = createElement("button", { className: "secondary icon-action-button" }, [
      createElement("span", { className: "action-sprite-icon" }),
      createElement("span", {}, "Use in planner"),
    ]);

    button.type = "button";
    button.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("petdb:use-system-in-planner", {
        detail: {
          id: station.systemId,
          name: station.systemName,
        },
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

  function renderCommodities(commodities) {
    const body = select("[data-station-commodities]");

    if (!body) {
      return;
    }

    if (commodities.length === 0) {
      body.replaceChildren(createEmptyRow("No commodities recorded for this station."));
      return;
    }

    body.replaceChildren(...commodities.map((commodity) => {
      const row = document.createElement("tr");
      row.append(
        createElement("td", {}, commodity.name || "Unknown"),
        createElement("td", {}, commodity.category || "unknown"),
        createElement("td", {}, formatCredits(commodity.stationBuyPrice)),
        createElement("td", {}, formatCredits(commodity.stationSellPrice)),
        createElement("td", {}, formatQuantity(commodity.demand, commodity.demandLevel)),
        createElement("td", {}, formatQuantity(commodity.stock, commodity.stockLevel)),
        createElement("td", {}, formatDate(commodity.collectedAt)),
      );
      return row;
    }));
  }

  function renderEmpty(message) {
    const summary = select("[data-station-summary]");
    const commodities = select("[data-station-commodities]");

    if (summary) {
      summary.replaceChildren(createElement("p", { className: "muted" }, message));
    }

    if (commodities) {
      commodities.replaceChildren(createEmptyRow(message));
    }
  }

  function createEmptyRow(message) {
    const cell = createElement("td", { className: "empty-table" }, message);
    cell.colSpan = 7;
    const row = document.createElement("tr");
    row.append(cell);
    return row;
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

  function formatCredits(value) {
    return typeof value === "number" && value > 0 ? formatNumber(value) + " cr" : "-";
  }

  function formatStationDisplayName(station) {
    return station.name + " | " + station.systemName;
  }

  function formatQuantity(value, level) {
    const parts = [];

    if (typeof value === "number") {
      parts.push(formatNumber(value));
    }

    if (level) {
      parts.push(level);
    }

    return parts.length > 0 ? parts.join(" ") : "-";
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

  window.addEventListener("petdb:station-selected", (event) => {
    const stationId = event.detail?.id;

    if (stationId) {
      loadStation(stationId).catch(() => setStatus("Could not load"));
    }
  });

  window.addEventListener("DOMContentLoaded", () => {
    const input = select("[data-station-search]");
    const loadButton = select("[data-station-load]");
    let searchTimer = 0;

    if (input instanceof HTMLInputElement) {
      input.addEventListener("input", () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          searchStations(input.value).catch(() => setStatus("Search failed"));
        }, 180);
      });
      input.addEventListener("change", () => {
        loadSelectedStation().catch(() => setStatus("Could not load"));
      });
    }

    if (loadButton instanceof HTMLButtonElement) {
      loadButton.addEventListener("click", () => {
        loadSelectedStation().catch(() => setStatus("Could not load"));
      });
    }
  });
})();
