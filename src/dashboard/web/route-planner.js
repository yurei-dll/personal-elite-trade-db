(() => {
  const CHUNK_SIZE_LY = 100;
  const GRID_HALF_SIZE = 130;
  const WORLD_SCALE = (GRID_HALF_SIZE * 2) / CHUNK_SIZE_LY;
  const EDGE_GLOW_START = GRID_HALF_SIZE * 0.62;
  const EDGE_SWAP_THRESHOLD = GRID_HALF_SIZE * 0.98;
  const state = {
    animationFrame: 0,
    camera: undefined,
    cameraOrbit: {
      pitch: 0,
      radius: 220,
      target: { x: 0, y: 0, z: 0 },
      yaw: 0,
    },
    chunkCache: new Map(),
    chunkLoading: false,
    chunkOrigin: { x: 0, y: 0, z: 0 },
    edgeIndicators: undefined,
    edgeNavigationArmed: true,
    enabled: false,
    enabling: false,
    group: undefined,
    gridLabels: undefined,
    guideLines: undefined,
    hoveredSystem: undefined,
    dragDistance: 0,
    isDragging: false,
    isPanning: false,
    lastPointer: { x: 0, y: 0 },
    points: undefined,
    raycaster: undefined,
    referenceOrigin: { x: 0, y: 0, z: 0 },
    referenceSystem: undefined,
    renderer: undefined,
    resizeObserver: undefined,
    routeLine: undefined,
    routeToView: undefined,
    routeViewingMode: false,
    scene: undefined,
    searchResults: [],
    searchToken: 0,
    selectedSystem: undefined,
    selectedSystemStatsToken: 0,
    systemLabels: undefined,
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

  function readPlannerCargoSpace() {
    return Math.max(1, readPlannerInteger("[data-planner-cargo-space]", 100));
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
    updatePlannerCashflow(undefined);
    setPlannerPickupLabel(plannerState.pickup?.name || "Select system");
    resetPlannerReturnTimeline();

    if (typeof message === "string" && track) {
      track.replaceChildren(renderPlannerMessage(message));
    }
  }

  function setPlannerPickupLabel(message) {
    const label = select("[data-planner-pickup-label]");

    if (label) {
      label.textContent = message;
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

  async function useBestPlannerCommodity() {
    const track = select("[data-planner-track]");
    const commoditySelect = select("[data-planner-commodity]");

    if (!(commoditySelect instanceof HTMLSelectElement) || !plannerState.pickup || plannerState.commodities.length === 0) {
      setPlannerStatus("No commodities");
      return;
    }

    const maxRange = Math.max(1, readPlannerNumber("[data-planner-max-range]", 30));
    const maxJumps = Math.max(1, readPlannerInteger("[data-planner-max-jumps]", 8));
    const params = new URLSearchParams({
      includeFleetCarriers: String(readPlannerIncludeFleetCarriers()),
      includePlanetary: String(readPlannerIncludePlanetary()),
      maxJumps: String(maxJumps),
      maxRange: String(maxRange),
      originSystemId: String(plannerState.pickup.id),
      padSize: readPlannerPadSize(),
      requireDestinationDemand: String(readPlannerRequireDestinationDemand()),
    });

    setPlannerStatus("Finding best");
    setPlannerLoading(true);

    try {
      const response = await window.fetch("/dashboard/data/route-planner/best-trade-route?" + params.toString(), {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        if (track) {
          track.replaceChildren(renderPlannerMessage("Could not find the best route for those settings."));
        }
        clearPlannerRoute();
        setPlannerStatus("Best failed");
        return;
      }

      const result = await response.json();

      if (!result.route) {
        if (track) {
          track.replaceChildren(renderPlannerMessage("No buyer found inside " + formatNumber(maxRange * maxJumps) + " ly with " + formatPadSize(readPlannerPadSize()) + " pads."));
        }
        clearPlannerRoute();
        setPlannerBuyerLabel("No match");
        setPlannerStatus("No route");
        return;
      }

      commoditySelect.value = result.route.commodity.id;
      renderPlannerRoute(result.route);
    } finally {
      setPlannerLoading(false);
    }
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
    const waypoints = readPlannerWaypoints(route);
    const routePoints = [
      plannerState.pickup,
      ...waypoints,
      {
        ...route.destination,
        name: route.destination.systemName,
      },
    ];
    const segmentCount = Math.max(1, routePoints.length - 1);
    const hops = waypoints.map((point, index) => ({
      name: point.name || point.systemName || "Unknown system",
      position: ((index + 1) / segmentCount) * 100,
      x: point.x,
      y: point.y,
      z: point.z,
    }));
    const bracket = createElement("div", { className: "timeline-bracket" }, [
      createElement("span", {}, formatNumber(route.distance) + " ly total"),
    ]);
    const segmentLabels = renderPlannerSegmentLabels(routePoints, false);

    track.replaceChildren(bracket, ...segmentLabels, ...hops.map((hop) => renderPlannerHop(hop)));

    plannerState.route = route;
    updatePlannerCopyButtons(route);
    updatePlannerPlanetaryEndpoint("source", Boolean(route.source?.isPlanetary));
    updatePlannerPlanetaryEndpoint("destination", Boolean(route.destination?.isPlanetary));
    renderPlannerReturnTimeline(route);
    updatePlannerCashflow(route);
    setPlannerEndpointLabels(route);
    updatePlannerRouteStatus(route, jumps);
  }

  function setPlannerEndpointLabels(route) {
    const pickupLabel = select("[data-planner-pickup-label]");

    if (pickupLabel) {
      pickupLabel.textContent = formatPlannerStationLabel(route.source?.stationName, plannerState.pickup?.name, route.source?.distanceToArrival);
    }

    setPlannerBuyerLabel(formatPlannerStationLabel(route.destination?.stationName, route.destination?.systemName, route.destination?.distanceToArrival));
  }

  function formatPlannerStationLabel(stationName, systemName, distanceToArrival) {
    const parts = [];

    if (stationName) {
      parts.push(stationName);
    }

    if (systemName) {
      parts.push(systemName);
    }

    if (typeof distanceToArrival === "number") {
      parts.push(formatNumber(distanceToArrival) + " ls");
    }

    return parts.join(" | ") || "Unknown market";
  }

  function updatePlannerRouteStatus(route, jumps) {
    const totalProfit = calculatePlannerTripProfit(route);

    setPlannerStatus(
      formatNumber(jumps) + " jumps | " + formatSignedCredits(totalProfit) + " / trip | " + route.destination.stationName + formatRouteFreshness(route),
      { isLoss: totalProfit < 0 },
    );
  }

  function calculatePlannerTripProfit(route) {
    const cargoSpace = readPlannerCargoSpace();
    const outboundProfit = Number(route?.profit) || 0;
    const returnProfit = Number(route?.returnHaul?.profit) || 0;

    return (outboundProfit + returnProfit) * cargoSpace;
  }

  function updatePlannerCashflow(route) {
    const cargoSpace = readPlannerCargoSpace();

    setPlannerCashBadge("[data-planner-source-cash]", route ? -(Number(route.source?.stationSellPrice) || 0) * cargoSpace : undefined);
    setPlannerCashBadge("[data-planner-destination-cash]", route ? (Number(route.stationBuyPrice) || 0) * cargoSpace : undefined);
    setPlannerCashBadge("[data-planner-return-source-cash]", route?.returnHaul ? -(Number(route.returnHaul.source?.stationSellPrice) || 0) * cargoSpace : undefined);
    setPlannerCashBadge("[data-planner-return-destination-cash]", route?.returnHaul ? (Number(route.returnHaul.destination?.stationBuyPrice) || 0) * cargoSpace : undefined);
  }

  function setPlannerCashBadge(selector, value) {
    const badge = select(selector);

    if (!(badge instanceof HTMLElement)) {
      return;
    }

    if (typeof value !== "number" || !Number.isFinite(value)) {
      badge.hidden = true;
      badge.textContent = "";
      return;
    }

    badge.hidden = false;
    badge.textContent = formatSignedCredits(value);
  }

  function readPlannerWaypoints(route) {
    return Array.isArray(route.waypoints) ? route.waypoints : [];
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
      endLabel.textContent = "Pickup system";
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

    const returnWaypoints = readPlannerWaypoints(route).slice().reverse();
    const returnPoints = [
      {
        ...route.destination,
        name: route.destination.systemName,
      },
      ...returnWaypoints,
      plannerState.pickup,
    ];
    const segmentCount = Math.max(1, returnPoints.length - 1);
    const returnHops = returnWaypoints.map((point, index) => ({
      name: point.name || point.systemName || "Unknown system",
      position: ((segmentCount - index - 1) / segmentCount) * 100,
      x: point.x,
      y: point.y,
      z: point.z,
    }));
    const bracket = createElement("div", { className: "timeline-bracket" }, [
      createElement("span", {}, formatNumber(route.distance) + " ly return"),
    ]);
    const segmentLabels = renderPlannerSegmentLabels(returnPoints, true);

    if (startLabel) {
      startLabel.textContent = route.returnHaul?.commodity?.name || "No return haul";
    }

    if (endLabel) {
      endLabel.textContent = plannerState.pickup.name;
    }

    track.replaceChildren(bracket, ...segmentLabels, ...returnHops.map((hop) => renderPlannerHop(hop)));
  }

  function renderPlannerSegmentLabels(points, isReturn) {
    const segmentCount = Math.max(1, points.length - 1);

    return points.slice(1).map((point, index) => {
      const previousPoint = points[index];
      const position = isReturn
        ? ((segmentCount - index - 0.5) / segmentCount) * 100
        : ((index + 0.5) / segmentCount) * 100;
      const label = createElement("span", { className: "timeline-segment-distance" }, formatNumber(calculateRouteDistance(previousPoint, point)) + " ly");

      label.style.setProperty("--timeline-position", String(position) + "%");
      return label;
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
    button.style.setProperty("--timeline-position", String(hop.position ?? 50) + "%");
    dot.className = "timeline-dot";
    name.className = "timeline-name";
    meta.className = "timeline-meta";
    name.textContent = hop.name;
    meta.textContent = formatNumber(hop.x) + ", " + formatNumber(hop.y) + ", " + formatNumber(hop.z);
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
    state.routeToView = isViewing ? route : undefined;

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
      renderViewedRoute(route);
      return;
    }

    setStatus(state.enabled ? "Route view closed." : "3D map is not loaded.");
    loadSystems().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }

  function updateRouteReferenceControls() {
    const routeLimitSelect = select("[data-route-limit]");
    const referenceInput = select("[data-route-reference-search]");
    const setReferenceButton = select("[data-route-set-reference]");
    const loadButton = select("[data-route-load]");

    renderReferenceControls();

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
    state.referenceOrigin = {
      x: Number(system?.x) || 0,
      y: Number(system?.y) || 0,
      z: Number(system?.z) || 0,
    };
    state.chunkCache.clear();
    renderReferenceControls();
  }

  function renderReferenceControls() {
    const system = state.referenceSystem;
    const reference = select("[data-route-reference]");
    const referenceInput = select("[data-route-reference-search]");
    const xInput = select("[data-route-origin-x]");
    const yInput = select("[data-route-origin-y]");
    const zInput = select("[data-route-origin-z]");

    if (xInput instanceof HTMLInputElement) {
      xInput.value = String(state.referenceOrigin.x);
    }

    if (yInput instanceof HTMLInputElement) {
      yInput.value = String(state.referenceOrigin.y);
    }

    if (zInput instanceof HTMLInputElement) {
      zInput.value = String(state.referenceOrigin.z);
    }

    if (referenceInput instanceof HTMLInputElement) {
      referenceInput.value = system?.name || "";
    }

    if (reference) {
      reference.textContent = system
        ? "Reference: " + system.name + " (" + formatNumber(system.x) + ", " + formatNumber(system.y) + ", " + formatNumber(system.z) + ")"
        : "Reference: galactic origin";
    }
  }

  function setSelectedRouteSystem(system) {
    state.selectedSystem = system;

    const name = select("[data-route-selection-name]");
    const coordinates = select("[data-route-selection-coordinates]");
    const distance = select("[data-route-selection-distance]");
    const openButton = select("[data-route-open-selected]");
    const useButton = select("[data-route-use-selected]");
    const token = state.selectedSystemStatsToken + 1;

    state.selectedSystemStatsToken = token;

    if (name) {
      name.textContent = system?.name || "No system selected";
    }

    if (coordinates) {
      coordinates.textContent = system
        ? [system.x, system.y, system.z].map(formatNumber).join(", ")
        : "--";
    }

    if (distance) {
      distance.textContent = typeof system?.distance === "number"
        ? formatNumber(system.distance) + " ly"
        : "--";
    }

    if (openButton instanceof HTMLButtonElement) {
      openButton.disabled = !system;
    }

    if (useButton instanceof HTMLButtonElement) {
      useButton.disabled = !system;
    }

    renderSelectedRouteSystemStats(system);

    if (system && !hasRouteSystemStats(system)) {
      hydrateSelectedRouteSystemStats(system.id, token).catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
    }
  }

  function hasRouteSystemStats(system) {
    return typeof system.marketCount === "number"
      && typeof system.carrierCount === "number"
      && typeof system.planetaryMarketCount === "number";
  }

  function renderSelectedRouteSystemStats(system) {
    const markets = select("[data-route-selection-markets]");
    const carriers = select("[data-route-selection-carriers]");
    const planetaryMarkets = select("[data-route-selection-planetary-markets]");
    const fallback = system ? "Loading..." : "--";

    if (markets) {
      markets.textContent = typeof system?.marketCount === "number" ? formatNumber(system.marketCount) : fallback;
    }

    if (carriers) {
      carriers.textContent = typeof system?.carrierCount === "number" ? formatNumber(system.carrierCount) : fallback;
    }

    if (planetaryMarkets) {
      planetaryMarkets.textContent = typeof system?.planetaryMarketCount === "number" ? formatNumber(system.planetaryMarketCount) : fallback;
    }
  }

  async function hydrateSelectedRouteSystemStats(systemId, token) {
    const response = await window.fetch("/dashboard/data/route-planner/systems/" + encodeURIComponent(systemId), {
      headers: {
        Accept: "application/json",
      },
    });

    if (token !== state.selectedSystemStatsToken || !response.ok) {
      return;
    }

    const result = await response.json();
    const hydratedSystem = result?.system;

    if (!hydratedSystem || hydratedSystem.id !== state.selectedSystem?.id) {
      return;
    }

    state.selectedSystem = {
      ...state.selectedSystem,
      carrierCount: Number(hydratedSystem.carrierCount) || 0,
      marketCount: Number(hydratedSystem.marketCount) || 0,
      planetaryMarketCount: Number(hydratedSystem.planetaryMarketCount) || 0,
    };
    state.systems = state.systems.map((system) => (
      system.id === state.selectedSystem?.id
        ? { ...system, ...state.selectedSystem }
        : system
    ));
    renderSelectedRouteSystemStats(state.selectedSystem);
  }

  function openSelectedRouteSystem() {
    const system = state.selectedSystem;

    if (!system) {
      setStatus("Select a system on the map first.");
      return;
    }

    activateTab("market-browser");
    window.dispatchEvent(new CustomEvent("petdb:system-selected", {
      detail: {
        id: system.id,
        name: system.name,
      },
    }));
  }

  function useSelectedRouteSystemInPlanner() {
    const system = state.selectedSystem;

    if (!system) {
      setStatus("Select a system on the map first.");
      return;
    }

    window.dispatchEvent(new CustomEvent("petdb:use-system-in-planner", {
      detail: system,
    }));
    setStatus(system.name + " sent to planner.");
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
    const name = createElement("span", { className: "route-hover-name" }, system.name);

    hover.hidden = false;
    hover.replaceChildren(name);
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

    if (tabName === "galaxy-map") {
      window.requestAnimationFrame(resizeRoutePlanner);
    }
  }

  function getThree() {
    if (!threePromise) {
      threePromise = import("/dashboard/assets/three.module.js");
    }

    return threePromise;
  }

  async function enableRoutePlanner() {
    const canvas = select("[data-route-canvas]");
    const loadButton = select("[data-route-load]");

    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }

    if (state.enabled || state.enabling) {
      return;
    }

    state.enabling = true;
    setStatus("Loading 3D renderer...");

    try {
      state.three = await getThree();
    } catch (error) {
      state.enabling = false;

      throw error;
    }

    state.enabled = true;
    state.enabling = false;
    canvas.hidden = false;

    if (loadButton instanceof HTMLButtonElement) {
      loadButton.disabled = state.routeViewingMode;
    }

    initializeScene(canvas, state.three);
    if (state.routeViewingMode) {
      renderViewedRoute(state.routeToView);
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
    group.add(new three.GridHelper(260, 16, 0x2f4058, 0x202b40));

    state.camera = camera;
    state.group = group;
    state.raycaster = raycaster;
    state.renderer = renderer;
    state.scene = scene;
    state.edgeIndicators = createEdgeIndicators(three);
    group.add(state.edgeIndicators);
    updateOrbitCamera();

    canvas.addEventListener("pointerdown", (event) => {
      state.isDragging = true;
      state.isPanning = event.shiftKey;
      state.dragDistance = 0;
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
      state.dragDistance += Math.abs(deltaX) + Math.abs(deltaY);

      if (state.isPanning || event.shiftKey) {
        state.isPanning = true;
        panCameraBy(deltaX, deltaY, canvas);
      } else {
        state.cameraOrbit.yaw -= deltaX * 0.007;
        state.cameraOrbit.pitch = Math.max(
          -Math.PI * 0.45,
          Math.min(Math.PI * 0.45, state.cameraOrbit.pitch + deltaY * 0.007),
        );
        updateOrbitCamera();
      }
      updateHoverAt(event, canvas);
    });
    canvas.addEventListener("pointerup", (event) => {
      state.isDragging = false;
      state.isPanning = false;
      canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();

      if (!state.camera) {
        return;
      }

      state.cameraOrbit.radius = Math.max(35, Math.min(1200, state.cameraOrbit.radius + event.deltaY * 0.35));
      updateOrbitCamera();
    }, { passive: false });
    canvas.addEventListener("pointerleave", () => setHoverSystem(undefined));
    canvas.addEventListener("click", (event) => {
      if (state.dragDistance > 4) {
        return;
      }

      if (event.shiftKey) {
        panCameraAt(event, canvas);
        return;
      }

      selectSystemAt(event, canvas);
    });
    window.addEventListener("resize", resizeRoutePlanner);

    if (typeof ResizeObserver === "function") {
      state.resizeObserver = new ResizeObserver(resizeRoutePlanner);
      state.resizeObserver.observe(canvas);
    }

    resizeRoutePlanner();
    animateRoutePlanner();
  }

  function updateOrbitCamera() {
    if (!state.camera) {
      return;
    }

    const radius = state.cameraOrbit.radius;
    const pitch = state.cameraOrbit.pitch;
    const target = state.cameraOrbit.target;
    const yaw = state.cameraOrbit.yaw;
    const horizontalRadius = Math.cos(pitch) * radius;

    state.camera.position.set(
      target.x + Math.sin(yaw) * horizontalRadius,
      target.y + Math.sin(pitch) * radius,
      target.z + Math.cos(yaw) * horizontalRadius,
    );
    state.camera.lookAt(target.x, target.y, target.z);
  }

  function panCameraAt(event, canvas) {
    if (!state.camera || !state.raycaster || !state.three) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const pointer = new state.three.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const target = state.cameraOrbit.target;
    const targetPoint = new state.three.Vector3(target.x, target.y, target.z);
    const viewDirection = state.camera.getWorldDirection(new state.three.Vector3());
    const panPlane = new state.three.Plane().setFromNormalAndCoplanarPoint(viewDirection, targetPoint);
    const intersection = new state.three.Vector3();

    state.raycaster.setFromCamera(pointer, state.camera);
    if (!state.raycaster.ray.intersectPlane(panPlane, intersection)) {
      return;
    }

    state.cameraOrbit.target = {
      x: intersection.x,
      y: intersection.y,
      z: intersection.z,
    };
    updateOrbitCamera();
    setHoverSystem(undefined);
  }

  function panCameraBy(deltaX, deltaY, canvas) {
    if (!state.camera || !state.three) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const worldUnitsPerPixel = 2 * state.cameraOrbit.radius
      * Math.tan(state.three.MathUtils.degToRad(state.camera.fov) / 2)
      / Math.max(1, rect.height);
    const right = new state.three.Vector3().setFromMatrixColumn(state.camera.matrixWorld, 0);
    const up = new state.three.Vector3().setFromMatrixColumn(state.camera.matrixWorld, 1);
    const movement = right.multiplyScalar(-deltaX * worldUnitsPerPixel)
      .add(up.multiplyScalar(deltaY * worldUnitsPerPixel));
    const target = state.cameraOrbit.target;

    state.cameraOrbit.target = {
      x: target.x + movement.x,
      y: target.y + movement.y,
      z: target.z + movement.z,
    };
    updateOrbitCamera();
  }

  async function loadSystems() {
    if (!state.enabled) {
      return;
    }

    if (state.routeViewingMode) {
      setStatus("Exit route view to load nearest systems.");
      return;
    }

    const origin = { ...state.referenceOrigin };
    const limit = readLimit();
    setStatus("Loading nearest systems...");
    state.chunkCache.clear();
    const systems = await fetchSystemChunk(origin, limit);

    if (!systems) {
      setStatus("Could not load systems.");
      return;
    }

    state.chunkOrigin = origin;
    state.systems = systems;
    if (state.selectedSystem && !state.systems.some((system) => system.id === state.selectedSystem?.id)) {
      setSelectedRouteSystem(undefined);
    }
    renderSystems(origin);
    setStatus("Showing " + formatNumber(state.systems.length) + " nearest systems.");
  }

  async function fetchSystemChunk(origin, limit) {
    const key = chunkKey(origin);

    if (state.chunkCache.has(key)) {
      return state.chunkCache.get(key);
    }

    const params = new URLSearchParams({
      chunkSize: String(CHUNK_SIZE_LY),
      limit: String(limit),
      x: String(origin.x),
      y: String(origin.y),
      z: String(origin.z),
    });
    const response = await window.fetch("/dashboard/data/route-planner/systems?" + params.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return undefined;
    }

    const result = await response.json();
    const systems = Array.isArray(result.systems) ? result.systems : [];
    state.chunkCache.set(key, systems);
    return systems;
  }

  function chunkKey(origin) {
    return [origin.x, origin.y, origin.z, readLimit()].join(":");
  }

  function renderViewedRoute(route) {
    if (!state.enabled || !route || !plannerState.pickup) {
      return;
    }

    const routeSystems = buildViewedRouteSystems(route);

    if (routeSystems.length === 0) {
      setStatus("Route view could not find route systems.");
      return;
    }

    const origin = calculateRouteCenter(routeSystems);
    state.systems = routeSystems.map((system) => ({
      ...system,
      distance: calculateRouteDistance(origin, system),
    }));
    if (state.selectedSystem && !state.systems.some((system) => system.id === state.selectedSystem?.id)) {
      setSelectedRouteSystem(undefined);
    }
    renderSystems(origin);
    setStatus("Route view: " + routeSystems[0].name + " to " + routeSystems[routeSystems.length - 1].name + ".");
  }

  function buildViewedRouteSystems(route) {
    const systemsById = new Map();
    const addSystem = (system) => {
      if (!system?.id) {
        return;
      }

      systemsById.set(system.id, {
        id: system.id,
        name: system.name || system.systemName || "Unknown system",
        x: Number(system.x) || 0,
        y: Number(system.y) || 0,
        z: Number(system.z) || 0,
      });
    };

    addSystem(plannerState.pickup);
    readPlannerWaypoints(route).forEach((waypoint) => addSystem(waypoint));
    addSystem({
      id: route.destination?.systemId,
      name: route.destination?.systemName,
      x: route.destination?.x,
      y: route.destination?.y,
      z: route.destination?.z,
    });

    return [...systemsById.values()];
  }

  function calculateRouteCenter(systems) {
    const bounds = systems.reduce((current, system) => ({
      maxX: Math.max(current.maxX, Number(system.x) || 0),
      maxY: Math.max(current.maxY, Number(system.y) || 0),
      maxZ: Math.max(current.maxZ, Number(system.z) || 0),
      minX: Math.min(current.minX, Number(system.x) || 0),
      minY: Math.min(current.minY, Number(system.y) || 0),
      minZ: Math.min(current.minZ, Number(system.z) || 0),
    }), {
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
    });

    return {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
    };
  }

  function renderSystems(origin, options) {
    if (!state.three || !state.group) {
      return;
    }

    if (!options?.preserveCamera) {
      state.cameraOrbit.target = { x: 0, y: 0, z: 0 };
      updateOrbitCamera();
    }

    if (state.points) {
      state.group.remove(state.points);
      state.points.geometry.dispose();
      state.points.material.dispose();
      state.points = undefined;
    }

    if (state.guideLines) {
      state.group.remove(state.guideLines);
      state.guideLines.geometry.dispose();
      state.guideLines.material.dispose();
      state.guideLines = undefined;
    }

    if (state.routeLine) {
      state.group.remove(state.routeLine);
      state.routeLine.geometry.dispose();
      state.routeLine.material.dispose();
      state.routeLine = undefined;
    }

    clearGridLabels();
    clearSystemLabels();

    if (state.systems.length === 0) {
      setStatus("No systems found near that reference point.");
      return;
    }

    const three = state.three;
    const maxDistance = Math.max(1, ...state.systems.map((system) => Number(system.distance) || 0));
    const scale = state.routeViewingMode ? Math.min(8, 140 / maxDistance) : WORLD_SCALE;
    renderGridLabels(scale, origin);
    const positions = new Float32Array(state.systems.length * 3);
    const colors = new Float32Array(state.systems.length * 3);
    const guideLinePositions = new Float32Array(state.systems.length * 6);

    state.systems.forEach((system, index) => {
      const offset = index * 3;
      const guideOffset = index * 6;
      const distanceRatio = Math.min(1, (Number(system.distance) || 0) / maxDistance);
      positions[offset] = (Number(system.x) - origin.x) * scale;
      positions[offset + 1] = (Number(system.y) - origin.y) * scale;
      positions[offset + 2] = (Number(system.z) - origin.z) * scale;
      guideLinePositions[guideOffset] = positions[offset];
      guideLinePositions[guideOffset + 1] = positions[offset + 1];
      guideLinePositions[guideOffset + 2] = positions[offset + 2];
      guideLinePositions[guideOffset + 3] = positions[offset];
      guideLinePositions[guideOffset + 4] = 0;
      guideLinePositions[guideOffset + 5] = positions[offset + 2];
      colors[offset] = 0.28 + 0.5 * (1 - distanceRatio);
      colors[offset + 1] = 0.84;
      colors[offset + 2] = 1;
    });

    const guideLineGeometry = new three.BufferGeometry();
    guideLineGeometry.setAttribute("position", new three.BufferAttribute(guideLinePositions, 3));
    const guideLineMaterial = new three.LineBasicMaterial({
      color: 0x7f8794,
      opacity: 0.36,
      transparent: true,
    });
    const geometry = new three.BufferGeometry();
    geometry.setAttribute("position", new three.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new three.BufferAttribute(colors, 3));
    const material = new three.ShaderMaterial({
      vertexColors: true,
      uniforms: {
        baseSize: { value: 10 },
      },
      vertexShader: `
        uniform float baseSize;
        varying vec3 vColor;

        void main() {
          vColor = color;
          vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * modelViewPosition;
          gl_PointSize = clamp(baseSize * (260.0 / -modelViewPosition.z), 2.5, 7.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;

        void main() {
          vec2 point = gl_PointCoord - vec2(0.5);
          float alpha = 1.0 - smoothstep(0.16, 0.5, length(point));
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
    });

    state.guideLines = new three.LineSegments(guideLineGeometry, guideLineMaterial);
    state.points = new three.Points(geometry, material);
    state.systemLabels = createSystemLabels(three, positions);
    state.routeLine = state.routeViewingMode ? createRouteLine(three, positions) : undefined;
    state.group.add(state.guideLines);
    if (state.routeLine) {
      state.group.add(state.routeLine);
    }
    state.group.add(state.points);
    state.group.add(state.systemLabels);
    updateSystemLabelVisibility();
  }

  function createRouteLine(three, positions) {
    const geometry = new three.BufferGeometry();
    geometry.setAttribute("position", new three.BufferAttribute(positions, 3));
    const material = new three.LineBasicMaterial({
      color: 0x2f9dff,
      linewidth: 2,
      opacity: 0.95,
      transparent: true,
    });

    return new three.Line(geometry, material);
  }

  function clearSystemLabels() {
    if (!state.systemLabels || !state.group) {
      return;
    }

    state.group.remove(state.systemLabels);
    disposeLabelGroup(state.systemLabels);
    state.systemLabels = undefined;
  }

  function createSystemLabels(three, positions) {
    const labels = new three.Group();

    state.systems.forEach((system, index) => {
      const offset = index * 3;
      labels.add(createSystemLabelSprite(
        three,
        system.name || "Unknown system",
        positions[offset],
        positions[offset + 1],
        positions[offset + 2],
      ));
    });

    return labels;
  }

  function createSystemLabelSprite(three, text, x, y, z) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const label = String(text).slice(0, 42);

    canvas.width = 320;
    canvas.height = 72;

    if (context) {
      context.font = "600 24px system-ui, sans-serif";
      const metrics = context.measureText(label);
      const textWidth = Math.min(canvas.width - 24, Math.ceil(metrics.width));
      context.fillStyle = "rgba(8, 9, 13, 0.72)";
      context.fillRect((canvas.width - textWidth - 20) / 2, 12, textWidth + 20, 44);
      context.strokeStyle = "rgba(127, 135, 148, 0.38)";
      context.strokeRect((canvas.width - textWidth - 20) / 2, 12, textWidth + 20, 44);
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "rgba(220, 235, 242, 0.92)";
      context.fillText(label, canvas.width / 2, canvas.height / 2);
    }

    const texture = new three.CanvasTexture(canvas);
    const material = new three.SpriteMaterial({
      depthTest: false,
      map: texture,
      opacity: 0.9,
      transparent: true,
    });
    const sprite = new three.Sprite(material);

    sprite.position.set(x, y + 5, z);
    sprite.renderOrder = 3;
    sprite.scale.set(36, 8.1, 1);
    sprite.userData.labelBounds = {
      height: 20,
      width: Math.min(160, Math.max(54, label.length * 7.5 + 18)),
    };

    return sprite;
  }

  function clearGridLabels() {
    if (!state.gridLabels || !state.group) {
      return;
    }

    state.group.remove(state.gridLabels);
    disposeLabelGroup(state.gridLabels);
    state.gridLabels = undefined;
  }

  function disposeLabelGroup(group) {
    group.traverse((node) => {
      if (node.material?.map) {
        node.material.map.dispose();
      }

      if (node.material) {
        node.material.dispose();
      }
    });
  }

  function renderGridLabels(scale, origin) {
    if (!state.three || !state.group) {
      return;
    }

    const three = state.three;
    const labels = new three.Group();
    const gridHalfSize = GRID_HALF_SIZE;
    const gridDivisions = 8;
    const gridStep = gridHalfSize / gridDivisions;

    for (let index = -gridDivisions; index <= gridDivisions; index += 1) {
      if (index === 0) {
        continue;
      }

      const displayPosition = index * gridStep;
      const xCoordinate = origin.x + displayPosition / scale;
      const zCoordinate = origin.z + displayPosition / scale;

      labels.add(createGridLabelSprite(three, formatMeasurementLabel("X", xCoordinate), displayPosition, 0, -gridHalfSize - 10));
      labels.add(createGridLabelSprite(three, formatMeasurementLabel("Z", zCoordinate), -gridHalfSize - 10, 0, displayPosition));
    }

    state.gridLabels = labels;
    state.group.add(labels);
  }

  function createGridLabelSprite(three, text, x, y, z) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = 192;
    canvas.height = 64;

    if (context) {
      context.font = "600 24px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "rgba(127, 135, 148, 0.92)";
      context.fillText(text, canvas.width / 2, canvas.height / 2);
    }

    const texture = new three.CanvasTexture(canvas);
    const material = new three.SpriteMaterial({
      depthTest: false,
      map: texture,
      opacity: 0.82,
      transparent: true,
    });
    const sprite = new three.Sprite(material);

    sprite.position.set(x, y + 2, z);
    sprite.scale.set(24, 8, 1);
    sprite.renderOrder = 2;

    return sprite;
  }

  function createEdgeIndicators(three) {
    const indicators = new three.Group();
    const arrowShape = new three.Shape();
    arrowShape.moveTo(-4, -7);
    arrowShape.lineTo(4, -7);
    arrowShape.lineTo(4, 1);
    arrowShape.lineTo(8, 1);
    arrowShape.lineTo(0, 9);
    arrowShape.lineTo(-8, 1);
    arrowShape.lineTo(-4, 1);
    arrowShape.closePath();
    const geometry = new three.ShapeGeometry(arrowShape);
    geometry.rotateX(-Math.PI / 2);
    const definitions = [
      { axis: "x", direction: -1, rotation: Math.PI / 2, x: -GRID_HALF_SIZE - 16, z: 0 },
      { axis: "x", direction: 1, rotation: -Math.PI / 2, x: GRID_HALF_SIZE + 16, z: 0 },
      { axis: "z", direction: -1, rotation: 0, x: 0, z: -GRID_HALF_SIZE - 16 },
      { axis: "z", direction: 1, rotation: Math.PI, x: 0, z: GRID_HALF_SIZE + 16 },
    ];

    definitions.forEach((definition) => {
      const indicator = new three.Group();
      const glowMaterial = new three.MeshBasicMaterial({
        blending: three.AdditiveBlending,
        color: 0x2f9dff,
        depthWrite: false,
        opacity: 0.1,
        side: three.DoubleSide,
        transparent: true,
      });
      const coreMaterial = new three.MeshBasicMaterial({
        color: 0x82d8ff,
        depthWrite: false,
        opacity: 0.35,
        side: three.DoubleSide,
        transparent: true,
      });
      const glow = new three.Mesh(geometry, glowMaterial);
      const core = new three.Mesh(geometry, coreMaterial);

      glow.scale.set(1.45, 1.45, 1.45);
      glow.position.y = -0.08;
      glow.renderOrder = 3;
      core.renderOrder = 4;
      indicator.add(glow);
      indicator.add(core);
      indicator.position.set(definition.x, 0.35, definition.z);
      indicator.rotation.y = definition.rotation;
      indicator.renderOrder = 4;
      indicator.userData.edge = definition;
      indicator.userData.coreMaterial = coreMaterial;
      indicator.userData.glowMaterial = glowMaterial;
      indicators.add(indicator);
    });

    return indicators;
  }

  function updateEdgeIndicators() {
    if (!state.edgeIndicators) {
      return;
    }

    const target = state.cameraOrbit.target;
    const centered = Math.abs(target.x) < EDGE_GLOW_START && Math.abs(target.z) < EDGE_GLOW_START;

    if (centered) {
      state.edgeNavigationArmed = true;
    }

    state.edgeIndicators.visible = !state.routeViewingMode;
    state.edgeIndicators.children.forEach((indicator) => {
      const edge = indicator.userData.edge;
      const signedPosition = target[edge.axis] * edge.direction;
      const progress = Math.max(0, Math.min(1,
        (signedPosition - EDGE_GLOW_START) / (EDGE_SWAP_THRESHOLD - EDGE_GLOW_START),
      ));

      indicator.userData.coreMaterial.opacity = 0.35 + progress * 0.65;
      indicator.userData.glowMaterial.opacity = 0.1 + progress * 0.5;
      const scale = 1 + progress * 0.22;
      indicator.scale.set(scale, scale, scale);
    });

    if (!state.routeViewingMode && state.edgeNavigationArmed && !state.chunkLoading) {
      const direction = readChunkDirection(target);

      if (direction) {
        loadAdjacentChunk(direction).catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
      }
    }
  }

  function readChunkDirection(target) {
    if (target.x <= -EDGE_SWAP_THRESHOLD) return { x: -1, z: 0 };
    if (target.x >= EDGE_SWAP_THRESHOLD) return { x: 1, z: 0 };
    if (target.z <= -EDGE_SWAP_THRESHOLD) return { x: 0, z: -1 };
    if (target.z >= EDGE_SWAP_THRESHOLD) return { x: 0, z: 1 };
    return undefined;
  }

  async function loadAdjacentChunk(direction) {
    state.chunkLoading = true;
    state.edgeNavigationArmed = false;
    const nextOrigin = {
      x: state.chunkOrigin.x + direction.x * CHUNK_SIZE_LY,
      y: state.chunkOrigin.y,
      z: state.chunkOrigin.z + direction.z * CHUNK_SIZE_LY,
    };

    try {
      setStatus("Loading adjacent map chunk...");
      const systems = await fetchSystemChunk(nextOrigin, readLimit());

      if (!systems) {
        state.edgeNavigationArmed = true;
        setStatus("Could not load adjacent map chunk.");
        return;
      }

      state.chunkOrigin = nextOrigin;
      state.systems = systems;
      state.cameraOrbit.target = {
        x: state.cameraOrbit.target.x - direction.x * GRID_HALF_SIZE * 2,
        y: state.cameraOrbit.target.y,
        z: state.cameraOrbit.target.z - direction.z * GRID_HALF_SIZE * 2,
      };
      renderSystems(nextOrigin, { preserveCamera: true });
      setStatus("Showing " + formatNumber(systems.length) + " systems in this map chunk.");
    } finally {
      state.chunkLoading = false;
    }
  }

  function formatMeasurementLabel(axis, value) {
    const rounded = Math.round(value);
    return axis + " " + formatNumber(rounded) + " ly";
  }

  function updateSystemLabelVisibility() {
    const canvas = select("[data-route-canvas]");

    if (!(canvas instanceof HTMLCanvasElement) || !state.camera || !state.systemLabels || !state.three) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const visibleBounds = [];
    const worldPosition = new state.three.Vector3();
    const projectedPosition = new state.three.Vector3();
    const labels = [...state.systemLabels.children]
      .map((label) => {
        label.getWorldPosition(worldPosition);
        projectedPosition.copy(worldPosition).project(state.camera);

        return {
          depth: state.camera.position.distanceTo(worldPosition),
          label,
          projectedX: projectedPosition.x,
          projectedY: projectedPosition.y,
          projectedZ: projectedPosition.z,
          x: (projectedPosition.x * 0.5 + 0.5) * rect.width,
          y: (-projectedPosition.y * 0.5 + 0.5) * rect.height,
        };
      })
      .filter((entry) => (
        entry.projectedX >= -1
        && entry.projectedX <= 1
        && entry.projectedY >= -1
        && entry.projectedY <= 1
        && entry.projectedZ >= -1
        && entry.projectedZ <= 1
      ))
      .sort((left, right) => left.depth - right.depth);

    state.systemLabels.children.forEach((label) => {
      label.visible = false;
    });

    labels.forEach((entry) => {
      const bounds = entry.label.userData.labelBounds || { height: 20, width: 80 };
      const candidate = {
        bottom: entry.y + bounds.height / 2,
        left: entry.x - bounds.width / 2,
        right: entry.x + bounds.width / 2,
        top: entry.y - bounds.height / 2,
      };

      if (visibleBounds.some((existing) => rectanglesOverlap(candidate, existing))) {
        return;
      }

      entry.label.visible = true;
      visibleBounds.push(candidate);
    });
  }

  function rectanglesOverlap(left, right) {
    return left.left < right.right
      && left.right > right.left
      && left.top < right.bottom
      && left.bottom > right.top;
  }

  function selectSystemAt(event, canvas) {
    const system = readSystemAt(event, canvas);

    if (system) {
      setSelectedRouteSystem(system);
      setStatus("Selected " + system.name + ".");
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
      updateEdgeIndicators();
      updateSystemLabelVisibility();
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

    const loadButton = select("[data-route-load]");
    const openSelectedRouteButton = select("[data-route-open-selected]");
    const useSelectedRouteButton = select("[data-route-use-selected]");
    const routeLimitSelect = select("[data-route-limit]");
    const referenceInput = select("[data-route-reference-search]");
    const setReferenceButton = select("[data-route-set-reference]");
    const plannerPickupInput = select("[data-planner-pickup-search]");
    const plannerCommoditySelect = select("[data-planner-commodity]");
    const plannerBuildButton = select("[data-planner-build]");
    const plannerUseBestButton = select("[data-planner-use-best]");
    const plannerCargoSpaceInput = select("[data-planner-cargo-space]");
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

    enableRoutePlanner().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));

    if (loadButton instanceof HTMLButtonElement) {
      loadButton.addEventListener("click", () => {
        loadSystems().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
      });
    }

    if (openSelectedRouteButton instanceof HTMLButtonElement) {
      openSelectedRouteButton.addEventListener("click", openSelectedRouteSystem);
    }

    if (useSelectedRouteButton instanceof HTMLButtonElement) {
      useSelectedRouteButton.addEventListener("click", useSelectedRouteSystemInPlanner);
    }

    if (routeLimitSelect instanceof HTMLSelectElement) {
      routeLimitSelect.addEventListener("change", () => {
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
      plannerUseBestButton.addEventListener("click", () => {
        useBestPlannerCommodity().catch((error) => setPlannerStatus(error instanceof Error ? error.message : String(error)));
      });
    }

    if (plannerCargoSpaceInput instanceof HTMLInputElement) {
      plannerCargoSpaceInput.addEventListener("input", () => {
        if (!plannerState.route) {
          return;
        }

        updatePlannerCashflow(plannerState.route);
        updatePlannerRouteStatus(plannerState.route, Math.max(1, Number(plannerState.route.jumps) || 1));
      });
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
