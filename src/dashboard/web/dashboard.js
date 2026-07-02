(() => {
  const storageKey = "petdb.dashboard.refreshSeconds";
  const defaultRefreshSeconds = "30";
  let refreshTimer;
  let inboundMessageSeries = { points: [], total: 0, windowMinutes: 0 };

  function readRefreshSeconds(select) {
    const storedValue = window.localStorage.getItem(storageKey);

    if (storedValue && select.querySelector(`option[value="${storedValue}"]`)) {
      return storedValue;
    }

    return defaultRefreshSeconds;
  }

  function updateRefreshLabel(value) {
    const label = document.querySelector("[data-refresh-label]");

    if (!label) {
      return;
    }

    label.textContent = value === "0" ? "manual refresh" : `auto-refresh ${value}s`;
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
    window.htmx.ajax("GET", `/dashboard/partials/summary?refreshSeconds=${refreshSeconds}`, {
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

    inboundMessageSeries = await response.json();
    drawInboundMessages(canvas, inboundMessageSeries);
  }

  function drawInboundMessages(canvas, series) {
    const points = Array.isArray(series.points) ? series.points : [];
    const counts = points.map((point) => Number(point.count) || 0);
    const total = typeof series.total === "number" ? series.total : counts.reduce((sum, count) => sum + count, 0);
    const windowMinutes = typeof series.windowMinutes === "number" ? series.windowMinutes : points.length;
    const totalLabel = document.querySelector("[data-inbound-total]");
    const emptyLabel = document.querySelector("[data-inbound-empty]");

    if (totalLabel) {
      totalLabel.textContent = `${formatNumber(total)} in ${formatNumber(windowMinutes)}m`;
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
    context.fillText(`${formatNumber(lastCount)} latest`, width - padding.right, padding.top + 2);
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
    const inboundChart = document.querySelector("[data-inbound-chart]");

    if (inboundChart instanceof HTMLCanvasElement) {
      drawInboundMessages(inboundChart, inboundMessageSeries);

      if (typeof ResizeObserver === "function") {
        const chartResizeObserver = new ResizeObserver(() => {
          drawInboundMessages(inboundChart, inboundMessageSeries);
        });

        chartResizeObserver.observe(inboundChart);
      }
    }

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
