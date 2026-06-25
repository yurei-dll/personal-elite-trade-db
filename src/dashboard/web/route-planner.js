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
    routeViewingMode: false,
    scene: undefined,
    searchResults: [],
    searchToken: 0,
    systems: [],
    three: undefined,
  };
  let threePromise;
  const plannerState = {
    commodities: [],
    pickup: undefined,
    pickupResults: [],
    pickupToken: 0,
    route: undefined,
  };

  function select(selector) {
    return document.querySelector(selector);
  }

  function readPlannerNumber(selector, fallback) {
    const input = select(selector);
    const value = input instanceof HTMLInputElement ? Number.parseFloat(input.value) : Number.NaN;

    return Number.isFinite(value) ? value : fallback;
  }

  function readPlannerInteger(selector, fallback) {
    const input = select(selector);
    const value = input instanceof HTMLInputElement ? Number.parseInt(input.value, 10) : Number.NaN;

    return Number.isFinite(value) ? value : fallback;
  }

  function setPlannerStatus(message, options) {
    const status = select("[data-planner-status]");

    if (status) {
      status.textContent = message;
      status.classList.toggle("loss", Boolean(options?.isLoss));
    }
  }

  function setPlannerEndpoint(kind, system) {
    plannerState.pickup = system;

    const label = select("[data-planner-pickup-label]");

    if (label) {
      label.textContent = system ? system.name : "Select system";
    }
  }

  async function useSystemInPlanner(system) {
    if (!system?.id) {
      return;
    }

    const hydratedSystem = typeof system.x === "number" && typeof system.y === "number" && typeof system.z === "number"
      ? system
      : await loadPlannerSystem(system.id, system.name);
    const input = select("[data-planner-pickup-search]");

    if (input instanceof HTMLInputElement) {
      input.value = hydratedSystem.name || "";
    }

    setPlannerEndpoint("pickup", {
      id: hydratedSystem.id,
      name: hydratedSystem.name || "Unknown system",
      x: Number(hydratedSystem.x) || 0,
      y: Number(hydratedSystem.y) || 0,
      z: Number(hydratedSystem.z) || 0,
    });
    clearPlannerRoute();
    setPlannerBuyerLabel("Best match");
    activateTab("route-planner");
    setPlannerStatus("Loading commodities");
    loadPlannerCommodities().catch((error) => setPlannerStatus(error instanceof Error ? error.message : String(error)));
  }

  async function loadPlannerSystem(systemId, fallbackName) {
    const response = await window.fetch("/dashboard/data/route-planner/systems/" + encodeURIComponent(systemId), {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return {
        id: systemId,
        name: fallbackName || "Unknown system",
        x: 0,
        y: 0,
        z: 0,
      };
    }

    const result = await response.json();
    return result.system || {
      id: systemId,
      name: fallbackName || "Unknown system",
      x: 0,
      y: 0,
      z: 0,
    };
  }

  function setPlannerBuyerLabel(message) {
    const label = select("[data-planner-buyer-label]");

    if (label) {
      label.textContent = message;
    }
  }

  function updatePlannerCopyButtons(route) {
    const sourceButton = select("[data-planner-copy-source]");
    const destinationButton = select("[data-planner-copy-destination]");
    const viewSourceButton = select("[data-planner-view-source]");
    const viewDestinationButton = select("[data-planner-view-destination]");
    const viewRouteButton = select("[data-planner-view-route]");

    if (sourceButton instanceof HTMLButtonElement) {
      sourceButton.disabled = !route;
      sourceButton.textContent = "Copy market";
    }

    if (destinationButton instanceof HTMLButtonElement) {
      destinationButton.disabled = !route;
      destinationButton.textContent = "Copy market";
    }

    if (viewSourceButton instanceof HTMLButtonElement) {
      viewSourceButton.disabled = !route;
    }

    if (viewDestinationButton instanceof HTMLButtonElement) {
      viewDestinationButton.disabled = !route;
    }

    if (viewRouteButton instanceof HTMLButtonElement) {
      viewRouteButton.disabled = !route;
    }
  }

  function clearPlannerRoute(message) {
    const track = select("[data-planner-track]");

    plannerState.route = undefined;
    updatePlannerCopyButtons(undefined);
    updatePlannerPlanetaryEndpoint("source", false);
    updatePlannerPlanetaryEndpoint("destination", false);
    resetPlannerReturnTimeline();

    if (typeof message === "string" && track) {
      track.replaceChildren(renderPlannerMessage(message));
    }
  }

  async function searchPlannerSystems(query) {
    const results = select("[data-planner-pickup-results]");
    const token = plannerState.pickupToken + 1;

    plannerState.pickupToken = token;

    if (!(results instanceof HTMLDataListElement)) {
      return;
    }

    if (!query.trim()) {
      plannerState.pickupResults = [];
      results.replaceChildren();
      setPlannerEndpoint("pickup", undefined);
      clearPlannerRoute();
      setPlannerBuyerLabel("Best match");
      resetPlannerCommodities("Choose pickup first");
      return;
    }

    const params = new URLSearchParams({ q: query.trim() });
    const response = await window.fetch("/dashboard/data/route-planner/system-search?" + params.toString(), {
      headers: {
        Accept: "application/json",
      },
    });

    if (token !== plannerState.pickupToken || !response.ok) {
      return;
    }

    const result = await response.json();
    plannerState.pickupResults = Array.isArray(result.systems) ? result.systems : [];
    results.replaceChildren(...plannerState.pickupResults.map((system) => {
      const option = document.createElement("option");
      option.value = system.name;
      option.label = system.name + " (" + formatNumber(system.x) + ", " + formatNumber(system.y) + ", " + formatNumber(system.z) + ")";
      return option;
    }));
  }

  function applyPlannerSearch() {
    const input = select("[data-planner-pickup-search]");

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const query = input.value.trim().toLowerCase();
    const match = plannerState.pickupResults.find((system) => system.name.toLowerCase() === query)
      ?? plannerState.pickupResults[0];

    if (!match) {
      setPlannerStatus("Search a pickup system first");
      return;
    }

    input.value = match.name;
    setPlannerEndpoint("pickup", match);
    setPlannerBuyerLabel("Best match");
    clearPlannerRoute();
    setPlannerStatus("Loading commodities");
    loadPlannerCommodities().catch((error) => setPlannerStatus(error instanceof Error ? error.message : String(error)));
  }

  function resetPlannerCommodities(message) {
    const commoditySelect = select("[data-planner-commodity]");
    const useBestButton = select("[data-planner-use-best]");

    plannerState.commodities = [];

    if (commoditySelect instanceof HTMLSelectElement) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = message;
      commoditySelect.replaceChildren(option);
      commoditySelect.disabled = true;
    }

    if (useBestButton instanceof HTMLButtonElement) {
      useBestButton.disabled = true;
    }
  }

  async function loadPlannerCommodities() {
    const commoditySelect = select("[data-planner-commodity]");

    if (!(commoditySelect instanceof HTMLSelectElement) || !plannerState.pickup) {
      return;
    }

    const params = new URLSearchParams({
      includeFleetCarriers: String(readPlannerIncludeFleetCarriers()),
      includePlanetary: String(readPlannerIncludePlanetary()),
      padSize: readPlannerPadSize(),
      systemId: String(plannerState.pickup.id),
    });
    const response = await window.fetch("/dashboard/data/route-planner/commodities?" + params.toString(), {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      resetPlannerCommodities("Could not load commodities");
      setPlannerStatus("No commodities");
      return;
    }

    const result = await response.json();
    plannerState.commodities = Array.isArray(result.commodities) ? result.commodities : [];

    if (plannerState.commodities.length === 0) {
      resetPlannerCommodities("No sellable commodities");
      setPlannerStatus("No commodities");
      return;
    }

    commoditySelect.disabled = false;
    commoditySelect.replaceChildren(...plannerState.commodities.map((commodity) => {
      const option = document.createElement("option");
      const price = typeof commodity.stationSellPrice === "number" ? " | " + formatCredits(commodity.stationSellPrice) : "";
      option.value = commodity.id;
      option.textContent = commodity.name + " | " + commodity.sourceStationName + price;
      return option;
    }));
    const useBestButton = select("[data-planner-use-best]");

    if (useBestButton instanceof HTMLButtonElement) {
      useBestButton.disabled = false;
    }

    setPlannerStatus(formatNumber(plannerState.commodities.length) + " commodities");
  }

  function useBestPlannerCommodity() {
    const commoditySelect = select("[data-planner-commodity]");

    if (!(commoditySelect instanceof HTMLSelectElement) || !plannerState.pickup || plannerState.commodities.length === 0) {
      setPlannerStatus("No commodities");
      return;
    }

    const bestCommodity = plannerState.commodities.slice().sort(comparePlannerCommodityValue)[0];

    if (!bestCommodity) {
      setPlannerStatus("No commodities");
      return;
    }

    commoditySelect.value = bestCommodity.id;
    clearPlannerRoute("Route will be built when Build route is pressed.");
    setPlannerBuyerLabel("Best match");
    setPlannerStatus("Selected " + bestCommodity.name);
  }

  function comparePlannerCommodityValue(left, right) {
    const leftStock = typeof left.stock === "number" ? left.stock : -1;
    const rightStock = typeof right.stock === "number" ? right.stock : -1;

    if (leftStock !== rightStock) {
      return rightStock - leftStock;
    }

    const leftPrice = typeof left.stationSellPrice === "number" ? left.stationSellPrice : -1;
    const rightPrice = typeof right.stationSellPrice === "number" ? right.stationSellPrice : -1;

    if (leftPrice !== rightPrice) {
      return rightPrice - leftPrice;
    }

    return String(left.name || "").localeCompare(String(right.name || ""));
  }

  async function buildPlannerRoute() {
    const track = select("[data-planner-track]");
    const commoditySelect = select("[data-planner-commodity]");

    if (!track) {
      return;
    }

    if (!plannerState.pickup) {
      track.replaceChildren(renderPlannerMessage("Select a pickup system and commodity, then build a route."));
      clearPlannerRoute();
      setPlannerStatus("Choose pickup");
      return;
    }

    const maxRange = Math.max(1, readPlannerNumber("[data-planner-max-range]", 30));
    const maxJumps = Math.max(1, readPlannerInteger("[data-planner-max-jumps]", 8));
    const commodityId = commoditySelect instanceof HTMLSelectElement ? commoditySelect.value : "";

    if (!commodityId) {
      track.replaceChildren(renderPlannerMessage("Choose a commodity sold at the pickup system."));
      clearPlannerRoute();
      setPlannerStatus("Choose commodity");
      return;
    }

    const params = new URLSearchParams({
      commodityId,
      includeFleetCarriers: String(readPlannerIncludeFleetCarriers()),
      includePlanetary: String(readPlannerIncludePlanetary()),
      maxJumps: String(maxJumps),
      maxRange: String(maxRange),
      originSystemId: String(plannerState.pickup.id),
      padSize: readPlannerPadSize(),
      requireDestinationDemand: String(readPlannerRequireDestinationDemand()),
    });

    setPlannerStatus("Finding buyer");
    setPlannerLoading(true);

    try {
      const response = await window.fetch("/dashboard/data/route-planner/trade-route?" + params.toString(), {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        track.replaceChildren(renderPlannerMessage("Could not build a trade route for those settings."));
        clearPlannerRoute();
        setPlannerStatus("Route failed");
        return;
      }

      const result = await response.json();

      if (!result.route) {
        track.replaceChildren(renderPlannerMessage("No buyer found inside " + formatNumber(maxRange * maxJumps) + " ly with " + formatPadSize(readPlannerPadSize()) + " pads."));
        clearPlannerRoute();
        setPlannerBuyerLabel("No match");
        setPlannerStatus("No route");
        return;
      }

      renderPlannerRoute(result.route);
    } finally {
      setPlannerLoading(false);
    }
  }

  function setPlannerLoading(isLoading) {
    const overlay = select("[data-planner-loading]");
    const buildButton = select("[data-planner-build]");
    const useBestButton = select("[data-planner-use-best]");

    if (overlay instanceof HTMLElement) {
      overlay.hidden = !isLoading;
    }

    if (buildButton instanceof HTMLButtonElement) {
      buildButton.disabled = isLoading;
    }

    if (useBestButton instanceof HTMLButtonElement) {
      useBestButton.disabled = isLoading || plannerState.commodities.length === 0;
    }
  }

  function renderPlannerRoute(route) {
    const track = select("[data-planner-track]");

    if (!track || !plannerState.pickup) {
      return;
    }

    const jumps = Math.max(1, Number(route.jumps) || 1);
    const routePoints = readPlannerRoutePoints(route);
    const hops = routePoints.slice(1).map((point, index) => ({
      meta: formatNumber(calculateRouteDistance(routePoints[index], point)) + " ly",
      name: point.name || point.systemName || "Unknown system",
      x: point.x,
      y: point.y,
      z: point.z,
    }));
    const bracket = createElement("div", { className: "timeline-bracket" }, [
      createElement("span", {}, formatNumber(route.distance) + " ly total"),
    ]);

    track.replaceChildren(bracket, ...hops.map((hop) => renderPlannerHop(hop)));

    plannerState.route = route;
    updatePlannerCopyButtons(route);
    updatePlannerPlanetaryEndpoint("source", Boolean(route.source?.isPlanetary));
    updatePlannerPlanetaryEndpoint("destination", Boolean(route.destination?.isPlanetary));
    renderPlannerReturnTimeline(route);
    setPlannerBuyerLabel(route.destination.systemName);
    setPlannerStatus(
      formatNumber(jumps) + " jumps | " + formatSignedCredits(route.profit ?? 0) + " | " + route.destination.stationName + formatRouteFreshness(route),
      { isLoss: Number(route.profit) < 0 },
    );
  }

  function readPlannerRoutePoints(route) {
    return [
      plannerState.pickup,
      ...(Array.isArray(route.waypoints) ? route.waypoints : []),
      {
        ...route.destination,
        name: route.destination.systemName,
      },
    ];
  }

  function calculateRouteDistance(from, to) {
    const x = (Number(to.x) || 0) - (Number(from.x) || 0);
    const y = (Number(to.y) || 0) - (Number(from.y) || 0);
    const z = (Number(to.z) || 0) - (Number(from.z) || 0);

    return Math.sqrt((x * x) + (y * y) + (z * z));
  }

  function resetPlannerReturnTimeline() {
    const startLabel = select("[data-planner-return-start-label]");
    const endLabel = select("[data-planner-return-end-label]");
    const track = select("[data-planner-return-track]");

    if (startLabel) {
      startLabel.textContent = "Buyer system";
    }

    if (endLabel) {
      endLabel.textContent = "Original station";
    }

    if (track) {
      track.replaceChildren(renderPlannerMessage("Return haul appears after a route is built."));
    }
  }

  function renderPlannerReturnTimeline(route) {
    const startLabel = select("[data-planner-return-start-label]");
    const endLabel = select("[data-planner-return-end-label]");
    const track = select("[data-planner-return-track]");

    if (!track || !plannerState.pickup) {
      return;
    }

    const returnSummary = route.returnHaul
      ? route.returnHaul.commodity.name + " | " + formatSignedCredits(route.returnHaul.profit ?? 0)
      : "No return haul found";
    const routePoints = readPlannerRoutePoints(route).slice().reverse();
    const returnHops = routePoints.slice(1).map((point, index) => ({
      meta: formatNumber(calculateRouteDistance(routePoints[index], point)) + " ly",
      name: point.name || point.systemName || "Unknown system",
      x: point.x,
      y: point.y,
      z: point.z,
    }));
    const bracket = createElement("div", { className: "timeline-bracket" }, [
      createElement("span", {}, formatNumber(route.distance) + " ly return"),
    ]);

    if (startLabel) {
      startLabel.textContent = returnSummary;
    }

    if (endLabel) {
      endLabel.textContent = route.source.stationName + " | " + plannerState.pickup.name;
    }

    track.replaceChildren(bracket, ...returnHops.map((hop) => renderPlannerHop(hop)));
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

  function renderPlannerMessage(message) {
    const element = document.createElement("p");
    element.className = "muted timeline-message";
    element.textContent = message;
    return element;
  }

  function renderPlannerHop(hop) {
    const button = document.createElement("button");
    const dot = document.createElement("span");
    const name = document.createElement("span");
    const meta = document.createElement("span");

    button.type = "button";
    button.className = "timeline-hop";
    button.dataset.distance = hop.meta || "";
    dot.className = "timeline-dot";
    name.className = "timeline-name";
    meta.className = "timeline-meta";
    name.textContent = hop.name;
    meta.textContent = hop.meta || (formatNumber(hop.x) + ", " + formatNumber(hop.y) + ", " + formatNumber(hop.z));
    button.append(dot, name, meta);
    button.addEventListener("click", () => {
      document.querySelectorAll(".timeline-hop.expanded").forEach((node) => {
        if (node !== button) {
          node.classList.remove("expanded");
        }
      });
      button.classList.toggle("expanded");
    });

    return button;
  }

  function formatPadSize(value) {
    return value === "M" ? "medium" : "large";
  }

  function readPlannerPadSize() {
    const padSelect = select("[data-planner-pad-size]");

    return padSelect instanceof HTMLSelectElement && padSelect.value === "M" ? "M" : "L";
  }

  function readPlannerIncludePlanetary() {
    const input = select("[data-planner-include-planetary]");

    return input instanceof HTMLInputElement && input.checked;
  }

  function readPlannerIncludeFleetCarriers() {
    const input = select("[data-planner-include-fleet-carriers]");

    return input instanceof HTMLInputElement && input.checked;
  }

  function readPlannerRequireDestinationDemand() {
    const input = select("[data-planner-require-destination-demand]");

    return input instanceof HTMLInputElement && input.checked;
  }

  function updatePlannerPlanetaryEndpoint(kind, isPlanetary) {
    const node = select(kind === "source" ? "[data-planner-copy-source]" : "[data-planner-copy-destination]")?.closest(".timeline-node");
    const badge = select(kind === "source" ? "[data-planner-source-planetary]" : "[data-planner-destination-planetary]");

    if (node) {
      node.classList.toggle("planetary", isPlanetary);
    }

    if (badge instanceof HTMLElement) {
      badge.hidden = !isPlanetary;
    }
  }

  async function copyPlannerMarket(kind) {
    const route = plannerState.route;

    if (!route || !plannerState.pickup) {
      return;
    }

    const button = select(kind === "source" ? "[data-planner-copy-source]" : "[data-planner-copy-destination]");
    const market = kind === "source"
      ? route.source.stationName + ", " + plannerState.pickup.name
      : route.destination.stationName + ", " + route.destination.systemName;

    await writeClipboardText(market);

    if (button instanceof HTMLButtonElement) {
      button.textContent = "Copied";
      window.setTimeout(() => {
        button.textContent = "Copy market";
      }, 1200);
    }
  }

  function viewPlannerMarket(kind) {
    const route = plannerState.route;

    if (!route) {
      return;
    }

    const station = kind === "source"
      ? {
          id: route.source.stationId,
          name: route.source.stationName,
        }
      : {
          id: route.destination.stationId,
          name: route.destination.stationName,
        };

    activateTab("station-browser");
    window.dispatchEvent(new CustomEvent("petdb:station-selected", {
      detail: station,
    }));
  }

  function viewPlannerRoute() {
    const route = plannerState.route;

    if (!route) {
      setPlannerStatus("Build a route first");
      return;
    }

    activateTab("galaxy-map");
    setRouteViewingMode(true, route);
    enableRoutePlanner().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }

  function setRouteViewingMode(isViewing, route) {
    state.routeViewingMode = isViewing;

    const banner = select("[data-route-view-banner]");
    const frame = select(".route-map-frame");
    const title = select("[data-route-map-title]");

    if (banner instanceof HTMLElement) {
      banner.hidden = !isViewing;
    }

    if (frame instanceof HTMLElement) {
      frame.classList.toggle("route-viewing", isViewing);
    }

    if (title instanceof HTMLElement) {
      title.hidden = isViewing;
    }

    updateRouteReferenceControls();

    if (isViewing) {
      const destinationName = route?.destination?.systemName || "route";
      setStatus("Route view: " + destinationName);
      return;
    }

    setStatus(state.enabled ? "Route view closed." : "3D map disabled. No systems loaded.");
  }

  function updateRouteReferenceControls() {
    const routeLimitSelect = select("[data-route-limit]");
    const referenceInput = select("[data-route-reference-search]");
    const setReferenceButton = select("[data-route-set-reference]");
    const loadButton = select("[data-route-load]");

    if (routeLimitSelect instanceof HTMLSelectElement) {
      routeLimitSelect.disabled = state.routeViewingMode;
    }

    if (referenceInput instanceof HTMLInputElement) {
      referenceInput.disabled = state.routeViewingMode;
    }

    if (setReferenceButton instanceof HTMLButtonElement) {
      setReferenceButton.disabled = state.routeViewingMode;
    }

    if (loadButton instanceof HTMLButtonElement) {
      loadButton.disabled = state.routeViewingMode || !state.enabled;
    }
  }

  async function writeClipboardText(value) {
    if (window.navigator.clipboard?.writeText) {
      await window.navigator.clipboard.writeText(value);
      return;
    }

    const input = document.createElement("input");
    input.value = value;
    input.style.left = "-9999px";
    input.style.position = "fixed";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
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
      hover.replaceChildren();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const icon = createElement("span", { className: "route-hover-icon" });
    const name = createElement("span", { className: "route-hover-name" }, system.name);

    hover.hidden = false;
    hover.replaceChildren(icon, name);
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
      loadButton.disabled = state.routeViewingMode;
    }

    initializeScene(canvas, state.three);
    if (state.routeViewingMode) {
      setStatus("Route view ready.");
      return;
    }

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

    if (state.routeViewingMode) {
      setStatus("Exit route view to load nearest systems.");
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
      activateTab("market-browser");
      window.dispatchEvent(new CustomEvent("petdb:system-selected", {
        detail: {
          id: system.id,
          name: system.name,
        },
      }));
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

    if (state.routeViewingMode) {
      setStatus("Exit route view to change reference.");
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

  function formatCredits(value) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0,
    }).format(value) + " cr";
  }

  function formatSignedCredits(value) {
    const numericValue = Number(value) || 0;
    const prefix = numericValue > 0 ? "+" : "";

    return prefix + formatCredits(numericValue);
  }

  function formatRouteFreshness(route) {
    const timestamps = [
      route?.source?.collectedAt,
      route?.destination?.collectedAt,
    ]
      .map((value) => new Date(value))
      .filter((date) => Number.isFinite(date.getTime()))
      .sort((left, right) => left.getTime() - right.getTime());

    if (timestamps.length === 0) {
      return "";
    }

    return " | data " + new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(timestamps[0]);
  }

  window.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-dashboard-tab]").forEach((tab) => {
      tab.addEventListener("click", () => activateTab(tab.getAttribute("data-dashboard-tab") || "dashboard"));
    });

    const enableButton = select("[data-route-enable]");
    const loadButton = select("[data-route-load]");
    const referenceInput = select("[data-route-reference-search]");
    const setReferenceButton = select("[data-route-set-reference]");
    const plannerPickupInput = select("[data-planner-pickup-search]");
    const plannerCommoditySelect = select("[data-planner-commodity]");
    const plannerBuildButton = select("[data-planner-build]");
    const plannerUseBestButton = select("[data-planner-use-best]");
    const plannerMaxRangeInput = select("[data-planner-max-range]");
    const plannerMaxJumpsInput = select("[data-planner-max-jumps]");
    const plannerPadSizeSelect = select("[data-planner-pad-size]");
    const plannerIncludeFleetCarriersInput = select("[data-planner-include-fleet-carriers]");
    const plannerIncludePlanetaryInput = select("[data-planner-include-planetary]");
    const plannerRequireDestinationDemandInput = select("[data-planner-require-destination-demand]");
    const plannerCopySourceButton = select("[data-planner-copy-source]");
    const plannerCopyDestinationButton = select("[data-planner-copy-destination]");
    const plannerViewSourceButton = select("[data-planner-view-source]");
    const plannerViewDestinationButton = select("[data-planner-view-destination]");
    const plannerViewRouteButton = select("[data-planner-view-route]");
    const routeExitViewButton = select("[data-route-exit-view]");
    let referenceSearchTimer = 0;
    let plannerPickupTimer = 0;

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

    if (plannerPickupInput instanceof HTMLInputElement) {
      plannerPickupInput.addEventListener("input", () => {
        window.clearTimeout(plannerPickupTimer);
        plannerPickupTimer = window.setTimeout(() => {
          searchPlannerSystems(plannerPickupInput.value).catch((error) => setPlannerStatus(error instanceof Error ? error.message : String(error)));
        }, 180);
      });
      plannerPickupInput.addEventListener("change", applyPlannerSearch);
    }

    if (plannerCommoditySelect instanceof HTMLSelectElement) {
      plannerCommoditySelect.addEventListener("change", () => {
        clearPlannerRoute("Route will be built when Build route is pressed.");
        setPlannerBuyerLabel("Best match");
        setPlannerStatus("Ready to build");
      });
    }

    if (plannerBuildButton instanceof HTMLButtonElement) {
      plannerBuildButton.addEventListener("click", () => {
        buildPlannerRoute().catch((error) => setPlannerStatus(error instanceof Error ? error.message : String(error)));
      });
    }

    if (plannerUseBestButton instanceof HTMLButtonElement) {
      plannerUseBestButton.addEventListener("click", useBestPlannerCommodity);
    }

    [
      plannerMaxRangeInput,
      plannerMaxJumpsInput,
      plannerPadSizeSelect,
      plannerIncludeFleetCarriersInput,
      plannerIncludePlanetaryInput,
      plannerRequireDestinationDemandInput,
    ].forEach((control) => {
      if (control) {
        control.addEventListener("change", () => {
          clearPlannerRoute("Route will be built when Build route is pressed.");
          setPlannerBuyerLabel("Best match");
          setPlannerStatus("Settings changed");
        });
      }
    });

    if (plannerCopySourceButton instanceof HTMLButtonElement) {
      plannerCopySourceButton.addEventListener("click", () => {
        copyPlannerMarket("source").catch((error) => setPlannerStatus(error instanceof Error ? error.message : String(error)));
      });
    }

    if (plannerCopyDestinationButton instanceof HTMLButtonElement) {
      plannerCopyDestinationButton.addEventListener("click", () => {
        copyPlannerMarket("destination").catch((error) => setPlannerStatus(error instanceof Error ? error.message : String(error)));
      });
    }

    if (plannerViewSourceButton instanceof HTMLButtonElement) {
      plannerViewSourceButton.addEventListener("click", () => viewPlannerMarket("source"));
    }

    if (plannerViewDestinationButton instanceof HTMLButtonElement) {
      plannerViewDestinationButton.addEventListener("click", () => viewPlannerMarket("destination"));
    }

    if (plannerViewRouteButton instanceof HTMLButtonElement) {
      plannerViewRouteButton.addEventListener("click", viewPlannerRoute);
    }

    if (routeExitViewButton instanceof HTMLButtonElement) {
      routeExitViewButton.addEventListener("click", () => setRouteViewingMode(false));
    }

    window.addEventListener("petdb:use-system-in-planner", (event) => {
      useSystemInPlanner(event.detail).catch((error) => setPlannerStatus(error instanceof Error ? error.message : String(error)));
    });
  });
})();
