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
    isDragging: false,
    lastPointer: { x: 0, y: 0 },
    points: undefined,
    raycaster: undefined,
    renderer: undefined,
    scene: undefined,
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
    scene.add(new three.AxesHelper(70));
    scene.add(new three.GridHelper(180, 12, 0x263142, 0x182033));
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
      if (!state.isDragging || !state.group) {
        return;
      }

      const deltaX = event.clientX - state.lastPointer.x;
      const deltaY = event.clientY - state.lastPointer.y;
      state.lastPointer = { x: event.clientX, y: event.clientY };
      state.group.rotation.y += deltaX * 0.007;
      state.group.rotation.x += deltaY * 0.007;
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
    if (!state.camera || !state.points || !state.raycaster || !state.three) {
      return;
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
      setSelectedSystem(state.systems[index]);
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
  });
})();
`;
