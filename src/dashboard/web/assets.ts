import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const HTMX_SCRIPT = readFileSync(
  require.resolve("htmx.org/dist/htmx.min.js"),
  "utf8",
);

export const THREE_MODULE_SCRIPT = readFileSync(
  join(dirname(require.resolve("three")), "three.module.js"),
  "utf8",
);

export const THREE_CORE_SCRIPT = readFileSync(
  join(dirname(require.resolve("three")), "three.core.js"),
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

  function readActiveRefreshSeconds() {
    const select = document.querySelector("[data-refresh-rate]");

    if (select instanceof HTMLSelectElement) {
      return select.value;
    }

    return window.localStorage.getItem(storageKey) || defaultRefreshSeconds;
  }

  function refreshSummary() {
    const summary = document.querySelector("#summary");

    if (!summary || !window.htmx) {
      return;
    }

    const refreshSeconds = encodeURIComponent(readActiveRefreshSeconds());
    window.htmx.ajax("GET", \`/dashboard/partials/summary?refreshSeconds=\${refreshSeconds}\`, {
      swap: "outerHTML",
      target: "#summary",
    });
  }

  async function refreshInboundMessages() {
    const canvas = document.querySelector("[data-inbound-chart]");

    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }

    const response = await window.fetch("/dashboard/data/inbound-messages", {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return;
    }

    drawInboundMessages(canvas, await response.json());
  }

  function drawInboundMessages(canvas, series) {
    const points = Array.isArray(series.points) ? series.points : [];
    const counts = points.map((point) => Number(point.count) || 0);
    const total = typeof series.total === "number" ? series.total : counts.reduce((sum, count) => sum + count, 0);
    const windowMinutes = typeof series.windowMinutes === "number" ? series.windowMinutes : points.length;
    const totalLabel = document.querySelector("[data-inbound-total]");
    const emptyLabel = document.querySelector("[data-inbound-empty]");

    if (totalLabel) {
      totalLabel.textContent = \`\${formatNumber(total)} in \${formatNumber(windowMinutes)}m\`;
    }

    const hasMessages = total > 0;

    if (emptyLabel) {
      emptyLabel.hidden = hasMessages;
    }

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(180, Math.floor(rect.height || 180));
    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * devicePixelRatio);
    canvas.height = Math.floor(height * devicePixelRatio);

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    drawChartBackground(context, width, height);

    const padding = {
      bottom: 28,
      left: 44,
      right: 14,
      top: 18,
    };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const maxCount = Math.max(1, ...counts);

    drawChartGrid(context, padding, chartWidth, chartHeight, maxCount);

    if (!hasMessages || points.length === 0) {
      drawEmptyChart(context, width, height);
      return;
    }

    const coordinates = counts.map((count, index) => {
      const x = padding.left + (points.length === 1 ? chartWidth : (index / (points.length - 1)) * chartWidth);
      const y = padding.top + chartHeight - (count / maxCount) * chartHeight;

      return { x, y };
    });

    context.beginPath();
    context.moveTo(padding.left, padding.top + chartHeight);
    coordinates.forEach((point) => {
      context.lineTo(point.x, point.y);
    });
    context.lineTo(padding.left + chartWidth, padding.top + chartHeight);
    context.closePath();
    const fill = context.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
    fill.addColorStop(0, "rgba(72, 215, 255, 0.28)");
    fill.addColorStop(1, "rgba(72, 215, 255, 0.02)");
    context.fillStyle = fill;
    context.fill();

    context.beginPath();
    coordinates.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    context.strokeStyle = "#48d7ff";
    context.lineWidth = 2.5;
    context.stroke();

    const lastPoint = points[points.length - 1];
    const lastCount = counts[counts.length - 1] || 0;
    context.fillStyle = "#9aa7b8";
    context.font = "12px system-ui, sans-serif";
    context.textAlign = "left";
    context.fillText(points[0]?.label || "", padding.left, height - 8);
    context.textAlign = "right";
    context.fillText(lastPoint?.label || "", padding.left + chartWidth, height - 8);
    context.fillStyle = "#f4f7fb";
    context.fillText(\`\${formatNumber(lastCount)} latest\`, width - padding.right, padding.top + 2);
  }

  function drawChartBackground(context, width, height) {
    context.fillStyle = "#090c12";
    context.fillRect(0, 0, width, height);
  }

  function drawChartGrid(context, padding, chartWidth, chartHeight, maxCount) {
    context.strokeStyle = "#263142";
    context.lineWidth = 1;
    context.fillStyle = "#9aa7b8";
    context.font = "12px system-ui, sans-serif";
    context.textAlign = "right";

    for (let index = 0; index <= 3; index += 1) {
      const ratio = index / 3;
      const y = padding.top + ratio * chartHeight;
      const value = Math.round(maxCount - ratio * maxCount);

      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(padding.left + chartWidth, y);
      context.stroke();
      context.fillText(formatNumber(value), padding.left - 8, y + 4);
    }
  }

  function drawEmptyChart(context, width, height) {
    context.fillStyle = "#9aa7b8";
    context.font = "14px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText("Waiting for inbound EDDN messages", width / 2, height / 2);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-US").format(value);
  }

  function applyRefreshRate(value) {
    window.localStorage.setItem(storageKey, value);
    window.clearInterval(refreshTimer);
    updateRefreshLabel(value);
    refreshInboundMessages().catch(() => undefined);

    const seconds = Number.parseInt(value, 10);

    if (Number.isFinite(seconds) && seconds > 0) {
      refreshTimer = window.setInterval(() => {
        refreshSummary();
        refreshInboundMessages().catch(() => undefined);
      }, seconds * 1000);
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
    document.body.addEventListener("htmx:afterSwap", () => {
      updateRefreshLabel(readActiveRefreshSeconds());
    });
  });
})();
`;

export const ROUTE_PLANNER_SCRIPT = `
(() => {
  const state = {
    animationFrame: 0,
    camera: undefined,
    enabled: false,
    group: undefined,
    hoveredSystem: undefined,
    isDragging: false,
    lastPointer: { x: 0, y: 0 },
    points: undefined,
    raycaster: undefined,
    referenceSystem: undefined,
    renderer: undefined,
    scene: undefined,
    searchResults: [],
    searchToken: 0,
    systems: [],
    three: undefined,
  };
  let threePromise;

  function select(selector) {
    return document.querySelector(selector);
  }

  function readNumberInput(selector, fallback) {
    const input = select(selector);
    const value = input instanceof HTMLInputElement ? Number.parseFloat(input.value) : Number.NaN;

    return Number.isFinite(value) ? value : fallback;
  }

  function readLimit() {
    const selectElement = select("[data-route-limit]");
    const value = selectElement instanceof HTMLSelectElement ? Number.parseInt(selectElement.value, 10) : 100;

    return Number.isFinite(value) ? value : 100;
  }

  function setStatus(message) {
    const status = select("[data-route-status]");

    if (status) {
      status.textContent = message;
    }
  }

  function setSelectedSystem(system) {
    const selected = select("[data-route-selected]");

    if (!selected) {
      return;
    }

    if (!system) {
      selected.textContent = "No system selected.";
      return;
    }

    selected.textContent = system.name + " | " + formatNumber(system.distance) + " ly from reference";
  }

  function setReferenceSystem(system) {
    state.referenceSystem = system;

    const reference = select("[data-route-reference]");
    const xInput = select("[data-route-origin-x]");
    const yInput = select("[data-route-origin-y]");
    const zInput = select("[data-route-origin-z]");

    if (xInput instanceof HTMLInputElement) {
      xInput.value = String(system?.x ?? 0);
    }

    if (yInput instanceof HTMLInputElement) {
      yInput.value = String(system?.y ?? 0);
    }

    if (zInput instanceof HTMLInputElement) {
      zInput.value = String(system?.z ?? 0);
    }

    if (reference) {
      reference.textContent = system
        ? "Reference: " + system.name + " (" + formatNumber(system.x) + ", " + formatNumber(system.y) + ", " + formatNumber(system.z) + ")"
        : "Reference: galactic origin";
    }
  }

  function setHoverSystem(system, event, canvas) {
    const hover = select("[data-route-hover]");

    state.hoveredSystem = system;

    if (!hover) {
      return;
    }

    if (!system || !event || !canvas) {
      hover.hidden = true;
      hover.textContent = "";
      return;
    }

    const rect = canvas.getBoundingClientRect();
    hover.hidden = false;
    hover.textContent = system.name;
    hover.style.left = Math.round(event.clientX - rect.left) + "px";
    hover.style.top = Math.round(event.clientY - rect.top) + "px";
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

  function getThree() {
    if (!threePromise) {
      threePromise = import("/dashboard/assets/three.module.js");
    }

    return threePromise;
  }

  async function enableRoutePlanner() {
    const canvas = select("[data-route-canvas]");
    const enableButton = select("[data-route-enable]");
    const loadButton = select("[data-route-load]");

    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }

    if (state.enabled) {
      return;
    }

    setStatus("Loading 3D renderer...");
    state.three = await getThree();
    state.enabled = true;
    canvas.hidden = false;

    if (enableButton instanceof HTMLButtonElement) {
      enableButton.disabled = true;
      enableButton.textContent = "3D map enabled";
    }

    if (loadButton instanceof HTMLButtonElement) {
      loadButton.disabled = false;
    }

    initializeScene(canvas, state.three);
    await loadSystems();
  }

  function initializeScene(canvas, three) {
    const renderer = new three.WebGLRenderer({
      antialias: true,
      canvas,
    });
    const scene = new three.Scene();
    const camera = new three.PerspectiveCamera(58, 1, 0.1, 5000);
    const group = new three.Group();
    const raycaster = new three.Raycaster();

    raycaster.params.Points.threshold = 4;
    scene.background = new three.Color(0x090c12);
    scene.add(group);
    group.add(new three.AxesHelper(70));
    group.add(new three.GridHelper(180, 12, 0x263142, 0x182033));
    camera.position.set(0, 80, 220);
    camera.lookAt(0, 0, 0);

    state.camera = camera;
    state.group = group;
    state.raycaster = raycaster;
    state.renderer = renderer;
    state.scene = scene;

    canvas.addEventListener("pointerdown", (event) => {
      state.isDragging = true;
      state.lastPointer = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!state.group) {
        return;
      }

      if (!state.isDragging) {
        updateHoverAt(event, canvas);
        return;
      }

      const deltaX = event.clientX - state.lastPointer.x;
      const deltaY = event.clientY - state.lastPointer.y;
      state.lastPointer = { x: event.clientX, y: event.clientY };
      state.group.rotation.y += deltaX * 0.007;
      state.group.rotation.x += deltaY * 0.007;
      updateHoverAt(event, canvas);
    });
    canvas.addEventListener("pointerup", (event) => {
      state.isDragging = false;
      canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();

      if (!state.camera) {
        return;
      }

      state.camera.position.z = Math.max(35, Math.min(1200, state.camera.position.z + event.deltaY * 0.35));
    }, { passive: false });
    canvas.addEventListener("pointerleave", () => setHoverSystem(undefined));
    canvas.addEventListener("click", (event) => selectSystemAt(event, canvas));
    window.addEventListener("resize", resizeRoutePlanner);
    resizeRoutePlanner();
    animateRoutePlanner();
  }

  async function loadSystems() {
    if (!state.enabled) {
      return;
    }

    const origin = {
      x: readNumberInput("[data-route-origin-x]", 0),
      y: readNumberInput("[data-route-origin-y]", 0),
      z: readNumberInput("[data-route-origin-z]", 0),
    };
    const limit = readLimit();
    const params = new URLSearchParams({
      limit: String(limit),
      x: String(origin.x),
      y: String(origin.y),
      z: String(origin.z),
    });

    setStatus("Loading nearest systems...");
    const response = await window.fetch("/dashboard/data/route-planner/systems?" + params.toString(), {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      setStatus("Could not load systems.");
      return;
    }

    const result = await response.json();
    state.systems = Array.isArray(result.systems) ? result.systems : [];
    renderSystems(origin);
    setSelectedSystem(undefined);
    setStatus("Showing " + formatNumber(state.systems.length) + " nearest systems.");
  }

  function renderSystems(origin) {
    if (!state.three || !state.group) {
      return;
    }

    if (state.points) {
      state.group.remove(state.points);
      state.points.geometry.dispose();
      state.points.material.dispose();
      state.points = undefined;
    }

    if (state.systems.length === 0) {
      setStatus("No systems found near that reference point.");
      return;
    }

    const three = state.three;
    const maxDistance = Math.max(1, ...state.systems.map((system) => Number(system.distance) || 0));
    const scale = Math.min(8, 140 / maxDistance);
    const positions = new Float32Array(state.systems.length * 3);
    const colors = new Float32Array(state.systems.length * 3);

    state.systems.forEach((system, index) => {
      const offset = index * 3;
      const distanceRatio = Math.min(1, (Number(system.distance) || 0) / maxDistance);
      positions[offset] = (Number(system.x) - origin.x) * scale;
      positions[offset + 1] = (Number(system.y) - origin.y) * scale;
      positions[offset + 2] = (Number(system.z) - origin.z) * scale;
      colors[offset] = 0.28 + 0.5 * (1 - distanceRatio);
      colors[offset + 1] = 0.84;
      colors[offset + 2] = 1;
    });

    const geometry = new three.BufferGeometry();
    geometry.setAttribute("position", new three.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new three.BufferAttribute(colors, 3));
    const material = new three.PointsMaterial({
      size: 4,
      sizeAttenuation: true,
      vertexColors: true,
    });

    state.points = new three.Points(geometry, material);
    state.group.add(state.points);
  }

  function selectSystemAt(event, canvas) {
    const system = readSystemAt(event, canvas);

    if (system) {
      setSelectedSystem(system);
    }
  }

  function updateHoverAt(event, canvas) {
    setHoverSystem(readSystemAt(event, canvas), event, canvas);
  }

  function readSystemAt(event, canvas) {
    if (!state.camera || !state.points || !state.raycaster || !state.three) {
      return undefined;
    }

    const rect = canvas.getBoundingClientRect();
    const pointer = new state.three.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    state.raycaster.setFromCamera(pointer, state.camera);
    const intersections = state.raycaster.intersectObject(state.points);
    const index = intersections[0]?.index;

    if (typeof index === "number") {
      return state.systems[index];
    }

    return undefined;
  }

  async function searchReferenceSystems(query) {
    const results = select("[data-route-reference-results]");
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
    const response = await window.fetch("/dashboard/data/route-planner/system-search?" + params.toString(), {
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

  function applyReferenceSearch() {
    const input = select("[data-route-reference-search]");

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const query = input.value.trim().toLowerCase();
    const match = state.searchResults.find((system) => system.name.toLowerCase() === query)
      ?? state.searchResults[0];

    if (!match) {
      setStatus("Search for a reference system first.");
      return;
    }

    input.value = match.name;
    setReferenceSystem(match);
    setStatus("Reference set to " + match.name + ".");

    if (state.enabled) {
      loadSystems().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
    }
  }

  function resizeRoutePlanner() {
    const canvas = select("[data-route-canvas]");

    if (!(canvas instanceof HTMLCanvasElement) || !state.renderer || !state.camera) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(260, Math.floor(rect.height || 360));
    state.renderer.setPixelRatio(window.devicePixelRatio || 1);
    state.renderer.setSize(width, height, false);
    state.camera.aspect = width / height;
    state.camera.updateProjectionMatrix();
  }

  function animateRoutePlanner() {
    state.animationFrame = window.requestAnimationFrame(animateRoutePlanner);

    if (state.renderer && state.scene && state.camera) {
      state.renderer.render(state.scene, state.camera);
    }
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 1,
    }).format(value);
  }

  window.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-dashboard-tab]").forEach((tab) => {
      tab.addEventListener("click", () => activateTab(tab.getAttribute("data-dashboard-tab") || "dashboard"));
    });

    const enableButton = select("[data-route-enable]");
    const loadButton = select("[data-route-load]");
    const referenceInput = select("[data-route-reference-search]");
    const setReferenceButton = select("[data-route-set-reference]");
    let referenceSearchTimer = 0;

    if (enableButton instanceof HTMLButtonElement) {
      enableButton.addEventListener("click", () => {
        enableRoutePlanner().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
      });
    }

    if (loadButton instanceof HTMLButtonElement) {
      loadButton.addEventListener("click", () => {
        loadSystems().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
      });
    }

    if (referenceInput instanceof HTMLInputElement) {
      referenceInput.addEventListener("input", () => {
        window.clearTimeout(referenceSearchTimer);
        referenceSearchTimer = window.setTimeout(() => {
          searchReferenceSystems(referenceInput.value).catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
        }, 180);
      });
      referenceInput.addEventListener("change", applyReferenceSearch);
    }

    if (setReferenceButton instanceof HTMLButtonElement) {
      setReferenceButton.addEventListener("click", applyReferenceSearch);
    }
  });
})();
`;

export const MARKET_BROWSER_SCRIPT = `
(() => {
  const state = {
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
    setStatus("Loading...");

    const response = await window.fetch("/dashboard/data/market-browser/systems/" + encodeURIComponent(match.id), {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      setStatus("Could not load");
      renderEmpty("Could not load market data for that system.");
      return;
    }

    renderSystem(await response.json());
  }

  function renderSystem(result) {
    const system = result && typeof result.system === "object" ? result.system : undefined;
    const stations = Array.isArray(result?.markets) ? result.markets : [];
    const bought = Array.isArray(result?.commoditiesBought) ? result.commoditiesBought : [];
    const sold = Array.isArray(result?.commoditiesSold) ? result.commoditiesSold : [];

    if (!system) {
      setStatus("No data");
      renderEmpty("No market data found.");
      return;
    }

    setStatus(formatNumber(stations.length) + " markets");
    renderSummary(system, stations.length, bought.length, sold.length);
    renderStations(stations);
    renderCommodities("[data-market-bought]", bought, "No bought commodities recorded.");
    renderCommodities("[data-market-sold]", sold, "No sold commodities recorded.");
  }

  function renderSummary(system, marketCount, boughtCount, soldCount) {
    const summary = select("[data-market-summary]");

    if (!summary) {
      return;
    }

    summary.replaceChildren(
      createElement("strong", {}, system.name || "Unknown system"),
      createElement("dl", {}, [
        createSummaryItem("Coordinates", [system.x, system.y, system.z].map(formatNumber).join(", ")),
        createSummaryItem("Markets", formatNumber(marketCount)),
        createSummaryItem("Bought", formatNumber(boughtCount)),
        createSummaryItem("Sold", formatNumber(soldCount)),
      ]),
    );
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

    renderCommodities("[data-market-bought]", [], "No bought commodities recorded.");
    renderCommodities("[data-market-sold]", [], "No sold commodities recorded.");
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
  });
})();
`;

export const STATION_BROWSER_SCRIPT = `
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
`;
