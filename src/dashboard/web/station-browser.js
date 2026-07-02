(() => {
  const state = {
    commodities: [],
    searchResults: [],
    searchToken: 0,
    sort: { direction: "asc", key: "name" },
  };
  const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

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
    state.commodities = commodities;
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

    const sortedCommodities = sortRows(commodities, state.sort);

    body.replaceChildren(...sortedCommodities.map((commodity) => {
      const row = document.createElement("tr");
      row.append(
        createElement("td", {}, commodity.name || "Unknown"),
        createElement("td", {}, commodity.category || "unknown"),
        createElement("td", {}, formatCredits(commodity.stationBuyPrice)),
        createElement("td", {}, formatCredits(commodity.stationSellPrice)),
        createElement("td", {}, renderQuantity(commodity.demand, commodity.demandLevel)),
        createElement("td", {}, renderQuantity(commodity.stock, commodity.stockLevel)),
        createElement("td", {}, formatDate(commodity.collectedAt)),
      );
      return row;
    }));
  }

  function renderEmpty(message) {
    const summary = select("[data-station-summary]");
    const commodities = select("[data-station-commodities]");

    state.commodities = [];

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

  function sortRows(rows, sort) {
    return [...rows].sort((left, right) => compareValues(
      readSortValue(left, sort.key),
      readSortValue(right, sort.key),
      sort.direction,
    ));
  }

  function readSortValue(row, key) {
    const value = row[key];

    if ((key === "stationBuyPrice" || key === "stationSellPrice") && !(value > 0)) {
      return null;
    }

    return value;
  }

  function compareValues(left, right, direction) {
    const leftMissing = left === null || left === undefined || left === "";
    const rightMissing = right === null || right === undefined || right === "";

    if (leftMissing || rightMissing) {
      return leftMissing === rightMissing ? 0 : leftMissing ? 1 : -1;
    }

    const comparison = typeof left === "number" && typeof right === "number"
      ? left - right
      : collator.compare(String(left), String(right));
    return direction === "asc" ? comparison : -comparison;
  }

  function initializeSorting() {
    document.querySelectorAll("[data-station-sort]").forEach((header) => {
      const key = header.getAttribute("data-station-sort");
      const label = header.textContent || "";
      const button = createElement("button", { className: "table-sort-button" }, [
        createElement("span", {}, label),
        createElement("span", { className: "table-sort-arrow" }),
      ]);

      button.type = "button";
      button.addEventListener("click", () => {
        state.sort = {
          direction: state.sort.key === key && state.sort.direction === "asc" ? "desc" : "asc",
          key,
        };
        updateSortHeaders();
        renderCommodities(state.commodities);
      });
      header.replaceChildren(button);
    });
    updateSortHeaders();
  }

  function updateSortHeaders() {
    document.querySelectorAll("[data-station-sort]").forEach((header) => {
      const isActive = header.getAttribute("data-station-sort") === state.sort.key;
      const arrow = header.querySelector(".table-sort-arrow");
      header.setAttribute("aria-sort", isActive ? (state.sort.direction === "asc" ? "ascending" : "descending") : "none");

      if (arrow) {
        arrow.textContent = isActive ? (state.sort.direction === "asc" ? "↑" : "↓") : "";
      }
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

  function formatCredits(value) {
    return typeof value === "number" && value > 0 ? formatNumber(value) + " cr" : "-";
  }

  function formatStationDisplayName(station) {
    return station.name + " | " + station.systemName;
  }

  function renderQuantity(value, level) {
    const quantity = createElement("span", { className: "market-quantity" });
    const normalizedLevel = typeof level === "string" ? level.toLowerCase() : "";

    if (["none", "low", "medium", "high"].includes(normalizedLevel)) {
      const icon = document.createElement("img");
      icon.alt = normalizedLevel;
      icon.className = "market-level-icon";
      icon.src = `/dashboard/assets/img/${normalizedLevel}.png`;
      icon.title = normalizedLevel[0].toUpperCase() + normalizedLevel.slice(1);
      quantity.append(icon);
    } else if (level) {
      quantity.append(createElement("span", {}, level));
    }

    if (typeof value === "number") {
      quantity.append(createElement("span", {}, formatNumber(value)));
    }

    if (!quantity.hasChildNodes()) {
      quantity.append("-");
    }

    return quantity;
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

    initializeSorting();

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
