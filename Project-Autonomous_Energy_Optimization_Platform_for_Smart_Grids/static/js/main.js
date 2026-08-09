/* Grid Sense — dashboard logic. Vanilla canvas charts, no CDN dependency. */

const GREEN = "#22C58B";
const AMBER = "#FFAE42";
const BLUE = "#4C8DFF";
const RED = "#FF6B6B";
const MUTED = "#8B96A5";
const BORDER = "#212932";

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function fmt(n, decimals = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toFixed(decimals);
}
async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  return res.json();
}

/* ------------------------------------------------------------------ */
/* Sidebar nav — active state + mobile toggle                          */
/* ------------------------------------------------------------------ */
function setupNav() {
  const links = $all(".nav-link");
  const sections = links.map((l) => document.getElementById(l.dataset.section)).filter(Boolean);

  function onScroll() {
    let current = sections[0];
    const y = window.scrollY + 120;
    sections.forEach((s) => { if (s.offsetTop <= y) current = s; });
    links.forEach((l) => l.classList.toggle("is-active", l.dataset.section === current.id));
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const mobileBtn = $("#mobileMenuBtn");
  const sidebar = $("#sidebar");
  if (mobileBtn) {
    mobileBtn.addEventListener("click", () => sidebar.classList.toggle("is-open"));
    links.forEach((l) => l.addEventListener("click", () => sidebar.classList.remove("is-open")));
  }
}

/* ------------------------------------------------------------------ */
/* Generic canvas line chart (supports one or two series + band)       */
/* ------------------------------------------------------------------ */
function drawLineChart(canvas, series, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.parentElement.clientWidth;
  const cssHeight = canvas.height;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = cssWidth + "px";
  canvas.style.height = cssHeight + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const padding = { top: 14, right: 12, bottom: 26, left: 42 };
  const w = cssWidth - padding.left - padding.right;
  const h = cssHeight - padding.top - padding.bottom;

  if (!series.length || !series[0].points.length) {
    ctx.fillStyle = MUTED;
    ctx.font = "13px Inter, sans-serif";
    ctx.fillText("No data available yet — check the artifact paths in app.py", padding.left, cssHeight / 2);
    return;
  }

  let allVals = [];
  series.forEach((s) => s.points.forEach((p) => {
    allVals.push(p.y);
    if (p.lower !== undefined) allVals.push(p.lower);
    if (p.upper !== undefined) allVals.push(p.upper);
  }));
  const yMin = Math.min(...allVals) * 0.9;
  const yMax = Math.max(...allVals) * 1.1;
  const n = series[0].points.length;
  const xAt = (i) => padding.left + (n <= 1 ? 0 : (i / (n - 1)) * w);
  const yAt = (v) => padding.top + h - ((v - yMin) / (yMax - yMin || 1)) * h;

  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.fillStyle = MUTED;
  ctx.font = "10px 'JetBrains Mono', monospace";
  const gridLines = 4;
  for (let g = 0; g <= gridLines; g++) {
    const v = yMin + (g / gridLines) * (yMax - yMin);
    const y = yAt(v);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + w, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(1), 2, y + 3);
  }

  series.forEach((s) => {
    if (!s.band) return;
    ctx.beginPath();
    s.points.forEach((p, i) => {
      if (p.upper === undefined) return;
      const x = xAt(i), y = yAt(p.upper);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i].lower === undefined) continue;
      const x = xAt(i), y = yAt(s.points[i].lower);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = s.color + "33";
    ctx.fill();
  });

  series.forEach((s) => {
    ctx.beginPath();
    let started = false;
    s.points.forEach((p, i) => {
      if (p.y === null || p.y === undefined) { started = false; return; }
      const x = xAt(i), y = yAt(p.y);
      if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
    });
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    if (s.dashed) ctx.setLineDash([6, 4]); else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  ctx.fillStyle = MUTED;
  ctx.font = "10px 'JetBrains Mono', monospace";
  const labelIdx = [0, Math.floor((n - 1) / 2), n - 1];
  labelIdx.forEach((i) => {
    const label = series[0].points[i]?.label;
    if (!label) return;
    const x = xAt(i);
    ctx.fillText(label, Math.min(Math.max(x - 22, padding.left), padding.left + w - 55), cssHeight - 6);
  });
}

/* ------------------------------------------------------------------ */
/* Bar chart (for weekday vs weekend, monthly trend)                   */
/* ------------------------------------------------------------------ */
function drawBarChart(canvas, bars, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.parentElement.clientWidth;
  const cssHeight = canvas.height;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = cssWidth + "px";
  canvas.style.height = cssHeight + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const padding = { top: 14, right: 12, bottom: 30, left: 42 };
  const w = cssWidth - padding.left - padding.right;
  const h = cssHeight - padding.top - padding.bottom;

  if (!bars.length) {
    ctx.fillStyle = MUTED;
    ctx.font = "13px Inter, sans-serif";
    ctx.fillText("No data available yet", padding.left, cssHeight / 2);
    return;
  }

  const maxV = Math.max(...bars.map((b) => b.value)) * 1.15;
  const gap = opts.gap ?? 18;
  const barW = (w - gap * (bars.length - 1)) / bars.length;

  ctx.strokeStyle = BORDER;
  ctx.fillStyle = MUTED;
  ctx.font = "10px 'JetBrains Mono', monospace";
  for (let g = 0; g <= 3; g++) {
    const v = (g / 3) * maxV;
    const y = padding.top + h - (v / maxV) * h;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + w, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(1), 2, y + 3);
  }

  bars.forEach((b, i) => {
    const x = padding.left + i * (barW + gap);
    const barH = (b.value / maxV) * h;
    const y = padding.top + h - barH;
    const grad = ctx.createLinearGradient(0, y, 0, padding.top + h);
    grad.addColorStop(0, b.color || GREEN);
    grad.addColorStop(1, (b.color || GREEN) + "55");
    ctx.fillStyle = grad;
    ctx.beginPath();
    const r = 6;
    ctx.moveTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.lineTo(x + barW - r, y);
    ctx.arcTo(x + barW, y, x + barW, y + r, r);
    ctx.lineTo(x + barW, padding.top + h);
    ctx.lineTo(x, padding.top + h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = MUTED;
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(b.label, x + barW / 2, cssHeight - 8);
    ctx.textAlign = "left";
  });
}

/* ------------------------------------------------------------------ */
/* Donut chart                                                         */
/* ------------------------------------------------------------------ */
function drawDonut(canvas, slices, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.parentElement.clientWidth;
  const cssHeight = canvas.height;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = cssWidth + "px";
  canvas.style.height = cssHeight + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const cx = cssWidth / 2;
  const cy = cssHeight / 2;
  const outerR = Math.min(cssWidth, cssHeight) / 2 - 10;
  const innerR = outerR * 0.6;
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;

  let start = -Math.PI / 2;
  slices.forEach((s) => {
    const angle = (s.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    start += angle;
  });

  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  if (opts.centerLabel) {
    ctx.fillStyle = "#EDF1F5";
    ctx.font = "600 18px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(opts.centerLabel, cx, cy + 2);
    if (opts.centerSub) {
      ctx.fillStyle = MUTED;
      ctx.font = "10px Inter, sans-serif";
      ctx.fillText(opts.centerSub, cx, cy + 18);
    }
    ctx.textAlign = "left";
  }
}

/* ------------------------------------------------------------------ */
/* Overview KPIs                                                       */
/* ------------------------------------------------------------------ */
let OVERVIEW_DATA = null;

async function loadOverview() {
  OVERVIEW_DATA = await getJSON("/api/overview");
  const d = OVERVIEW_DATA;

  if (d.today) {
    $("#kpiToday").textContent = `${fmt(d.today.kwh)} kWh`;
    const delta = d.delta_today_vs_avg_pct;
    const sub = $("#kpiTodaySub");
    if (delta !== null && delta !== undefined) {
      sub.textContent = `${delta > 0 ? "+" : ""}${delta}% vs. average`;
      sub.className = "kpi-sub " + (delta > 0 ? "is-up" : "is-down");
    } else {
      sub.textContent = d.today.date;
    }
  } else {
    $("#kpiToday").textContent = "—";
    $("#kpiTodaySub").textContent = "No recent data found";
  }

  if (d.tomorrow) {
    $("#kpiTomorrow").textContent = `${fmt(d.tomorrow.kwh)} kWh`;
    $("#kpiTomorrowSub").textContent = d.tomorrow.date;
  } else {
    $("#kpiTomorrow").textContent = "—";
    $("#kpiTomorrowSub").textContent = "No forecast found";
  }

  if (d.avg_daily_kwh !== null && d.avg_daily_kwh !== undefined) {
    $("#kpiAvg").textContent = `${fmt(d.avg_daily_kwh)} kWh`;
  }
  if (d.peak_window) $("#kpiPeak").textContent = d.peak_window;
}

/* ------------------------------------------------------------------ */
/* Forecast section                                                    */
/* ------------------------------------------------------------------ */
let FORECAST_DATA = null;

async function loadForecastChart() {
  FORECAST_DATA = await getJSON("/api/forecast-chart");
  const select = $("#fcHouseholdSelect");
  FORECAST_DATA.households.forEach((h) => {
    const opt = document.createElement("option");
    opt.value = h; opt.textContent = h;
    select.appendChild(opt);
  });
  renderForecastChart("__aggregate__");
  select.addEventListener("change", (e) => renderForecastChart(e.target.value));

  if (FORECAST_DATA.forecast.length) {
    const tomorrow = FORECAST_DATA.forecast[0];
    $("#forecastDateLabel").textContent = `Tomorrow · ${tomorrow.date}`;
    $("#forecastBigNumber").textContent = `${fmt(tomorrow.value)} kWh`;
    $("#forecastRange").textContent = `expected range ${fmt(tomorrow.lower)}–${fmt(tomorrow.upper)} kWh`;
  }
}

function renderForecastChart(key) {
  if (!FORECAST_DATA) return;
  const history = FORECAST_DATA.history.map((h) => ({ label: h.date.slice(5), y: h.value }));
  let forecastRows = key === "__aggregate__" ? FORECAST_DATA.forecast : FORECAST_DATA.by_household[key];
  forecastRows = forecastRows || [];

  const histSeries = history.map((h) => ({ label: h.label, y: h.y }));
  const bridgeGap = history.length ? new Array(history.length - 1).fill(null).map(() => ({ y: null })) : [];
  const forecastSeries = [
    ...history.slice(0, -1).map(() => ({ y: null })),
    { label: history.length ? history[history.length - 1].label : "", y: history.length ? history[history.length - 1].y : null },
    ...forecastRows.map((f) => ({ label: f.date.slice(5), y: f.value, lower: f.lower, upper: f.upper })),
  ];
  const allLabels = [...history.map((h) => h.label), ...forecastRows.map((f) => f.date.slice(5))];
  const paddedHist = [...histSeries, ...forecastRows.map(() => ({ y: null }))].map((p, i) => ({ ...p, label: allLabels[i] }));
  const paddedForecast = forecastSeries.map((p, i) => ({ ...p, label: allLabels[i] }));

  drawLineChart($("#forecastChart"), [
    { points: paddedHist, color: BLUE },
    { points: paddedForecast, color: AMBER, dashed: true, band: true },
  ]);
}

async function loadActualVsPredicted() {
  const data = await getJSON("/api/actual-vs-predicted");
  const points = data.points.map((p) => ({ label: p.date.slice(5), y: p.actual }));
  const predPoints = data.points.map((p) => ({ label: p.date.slice(5), y: p.predicted }));
  drawLineChart($("#avpChart"), [
    { points, color: BLUE },
    { points: predPoints, color: AMBER },
  ]);
}

async function loadWeatherChart() {
  const data = await getJSON("/api/weather-relationship");
  const points = data.points.map((p) => ({ label: `${p.temp}°`, y: p.avg_kwh }));
  drawLineChart($("#weatherChart"), [{ points, color: GREEN }]);
  if (data.note) $("#weatherNote").textContent = data.note;
}

/* ------------------------------------------------------------------ */
/* Usage patterns                                                      */
/* ------------------------------------------------------------------ */
async function loadHourly() {
  const data = await getJSON("/api/usage/hourly");
  const points = data.hours.map((h, i) => ({ label: `${h}h`, y: data.values[i] }));
  drawLineChart($("#hourlyChart"), [{ points, color: AMBER }]);
  $("#peakUsageLabel").textContent = "18:00–21:00";
  $("#lowUsageLabel").textContent = "02:00–05:00";
}

async function loadWeekdayWeekend() {
  const data = await getJSON("/api/usage/weekday-weekend");
  if (data.weekday === null) { $("#weekdayNote").textContent = "No data available yet."; return; }
  drawBarChart($("#weekdayChart"), [
    { label: "Weekday", value: data.weekday, color: BLUE },
    { label: "Weekend", value: data.weekend, color: GREEN },
  ]);
  const delta = data.delta_pct;
  $("#weekdayNote").textContent = delta !== null
    ? `Weekend usage runs ${delta > 0 ? "about " + delta + "% above" : Math.abs(delta) + "% below"} weekday usage.`
    : "";
}

async function loadPeakOffpeak() {
  const data = await getJSON("/api/usage/peak-offpeak");
  drawDonut($("#peakDonut"), [
    { value: data.peak_pct, color: AMBER },
    { value: data.offpeak_pct, color: BLUE },
  ], { centerLabel: `${data.peak_pct}%`, centerSub: "peak hours" });
}

async function loadMonthly() {
  const data = await getJSON("/api/usage/monthly");
  const bars = data.months.map((m) => ({ label: m.month.slice(2), value: m.avg_kwh, color: GREEN }));
  drawBarChart($("#monthlyChart"), bars, { gap: 14 });
}

/* ------------------------------------------------------------------ */
/* Segments                                                             */
/* ------------------------------------------------------------------ */
async function loadSegments() {
  const data = await getJSON("/api/segments");
  const colors = [GREEN, AMBER, BLUE, RED];
  drawDonut($("#segmentDonut"), data.segments.map((s, i) => ({ value: s.households, color: colors[i % colors.length] })), {
    centerLabel: data.segments.reduce((a, s) => a + s.households, 0).toLocaleString(),
    centerSub: "households",
  });

  $("#segmentsCards").innerHTML = data.segments.map((s, i) => `
    <div class="segment-card" style="border-left-color:${colors[i % colors.length]}">
      <div class="segment-card__top">
        <span class="segment-card__title">${s.label}</span>
        <span class="segment-card__count">${s.households.toLocaleString()} households</span>
      </div>
      <p>${s.description}</p>
      <div class="segment-card__stats">
        <span>Avg daily: <b>${fmt(s.avg_daily_kwh)} kWh</b></span>
        <span>Weekend share: <b>${fmt(s.weekend_share * 100, 0)}%</b></span>
      </div>
    </div>
  `).join("");
}

/* ------------------------------------------------------------------ */
/* Optimization insights                                               */
/* ------------------------------------------------------------------ */
async function loadInsights() {
  const data = await getJSON("/api/insights");
  $("#insightsGrid").innerHTML = data.insights.map((i) => `
    <div class="insight-card">
      <span class="insight-card__icon">${i.icon}</span>
      <h3>${i.title}</h3>
      <p>${i.body}</p>
    </div>
  `).join("");
}

/* ------------------------------------------------------------------ */
/* Model details (collapsed)                                           */
/* ------------------------------------------------------------------ */
let MODEL_DETAILS_LOADED = false;
async function toggleModelDetails() {
  const section = $("#modelDetails");
  section.hidden = !section.hidden;
  if (!section.hidden) {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!MODEL_DETAILS_LOADED) {
      MODEL_DETAILS_LOADED = true;
      const data = await getJSON("/api/model-details");
      $("#modelDetailsBody").innerHTML = `
        ${data.leaderboard.map((m) => `
          <div class="md-row ${m.best ? "is-best" : ""}">
            <span>${m.name}</span>
            <span>MAE ${fmt(m.mae, 3)}</span>
            <span>RMSE ${fmt(m.rmse, 3)}</span>
            <span>R\u00b2 ${fmt(m.r2, 3)}</span>
            <span>${m.note}</span>
          </div>
        `).join("")}
        <div class="md-paths">
          <span>Model artifact: <code>${data.model_path}</code></span>
          <span>Notebook: <code>${data.notebook_path}</code></span>
          <span>Status: ${data.model_loaded ? "loaded" : "not found — " + (data.model_error || "")}</span>
        </div>
      `;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Status dot                                                          */
/* ------------------------------------------------------------------ */
async function loadStatus() {
  const dot = $("#statusDot");
  try {
    const data = await getJSON("/api/status");
    dot.classList.add(data.model_loaded ? "is-live" : "is-down");
  } catch (e) {
    dot.classList.add("is-down");
  }
}

/* ------------------------------------------------------------------ */
/* Prediction form                                                      */
/* ------------------------------------------------------------------ */
function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}
const SEASON_ENCODING = { Winter: 3, Spring: 1, Summer: 2, Autumn: 0 };
function seasonFromMonth(month) {
  if ([12, 1, 2].includes(month)) return "Winter";
  if ([3, 4, 5].includes(month)) return "Spring";
  if ([6, 7, 8].includes(month)) return "Summer";
  return "Autumn";
}
const TEMP_CATEGORY_ENCODING = { "Very Cold": 3, Cold: 0, Mild: 2, Hot: 1 };
function tempCategoryFromMax(tmax) {
  if (tmax < 0) return "Very Cold";
  if (tmax < 10) return "Cold";
  if (tmax < 22) return "Mild";
  return "Hot";
}
function computeCalendarFields() {
  const dateVal = $("#f_date").value;
  if (!dateVal) return null;
  const d = new Date(dateVal + "T00:00:00");
  const jsDay = d.getDay();
  const dayOfWeek = (jsDay + 6) % 7;
  const isWeekend = dayOfWeek >= 5 ? 1 : 0;
  const month = d.getMonth() + 1;
  const season = seasonFromMonth(month);
  return {
    Year: d.getFullYear(), Month: month, Day: d.getDate(), DayOfWeek: dayOfWeek,
    WeekNumber: isoWeekNumber(d), Quarter: Math.floor((month - 1) / 3) + 1,
    IsWeekend: isWeekend, Season: SEASON_ENCODING[season],
    seasonLabel: season, dayLabel: d.toLocaleDateString(undefined, { weekday: "long" }),
  };
}
function updateCalendarReadout() {
  const cal = computeCalendarFields();
  const readout = $("#calendarReadout");
  if (!cal) { readout.textContent = "Pick a date to derive calendar features."; return; }
  readout.textContent = `${cal.dayLabel}, week ${cal.WeekNumber}, Q${cal.Quarter}, ${cal.IsWeekend ? "weekend" : "weekday"}, ${cal.seasonLabel}`;
}
function randomizeWeather() {
  const rand = (min, max, decimals = 1) => (Math.random() * (max - min) + min).toFixed(decimals);
  $("#f_tmax").value = rand(-2, 28); $("#f_tmin").value = rand(-6, 18);
  $("#f_thigh").value = rand(0, 29); $("#f_tlow").value = rand(-8, 16);
  $("#f_humidity").value = rand(0.4, 0.95, 2); $("#f_wind").value = rand(0.5, 9, 1);
  $("#f_windb").value = Math.round(rand(0, 359, 0)); $("#f_pressure").value = rand(995, 1030, 1);
  $("#f_cloud").value = rand(0, 1, 2); $("#f_visibility").value = rand(3, 14, 1);
  $("#f_uv").value = Math.round(rand(0, 7, 0)); $("#f_moon").value = rand(0, 1, 2);
  $("#f_dew").value = rand(-4, 15, 1);
}

async function submitPrediction(ev) {
  ev.preventDefault();
  const cal = computeCalendarFields();
  if (!cal) { alert("Pick a date first."); return; }

  const payload = {
    temperatureMax: $("#f_tmax").value, temperatureMin: $("#f_tmin").value,
    temperatureHigh: $("#f_thigh").value, temperatureLow: $("#f_tlow").value,
    humidity: $("#f_humidity").value, windSpeed: $("#f_wind").value,
    windBearing: $("#f_windb").value, pressure: $("#f_pressure").value,
    cloudCover: $("#f_cloud").value, visibility: $("#f_visibility").value,
    uvIndex: $("#f_uv").value, moonPhase: $("#f_moon").value, dewPoint: $("#f_dew").value,
    IsHoliday: $("#f_holiday").checked ? 1 : 0,
    Year: cal.Year, Month: cal.Month, Day: cal.Day, DayOfWeek: cal.DayOfWeek,
    WeekNumber: cal.WeekNumber, Quarter: cal.Quarter, IsWeekend: cal.IsWeekend, Season: cal.Season,
    Lag_1: $("#f_lag1").value, Lag_7: $("#f_lag7").value, Lag_30: $("#f_lag30").value,
    Rolling_Mean_3: $("#f_roll3").value, Rolling_Mean_7: $("#f_roll7").value, Rolling_Std_7: $("#f_rollstd7").value,
    TemperatureCategory: TEMP_CATEGORY_ENCODING[tempCategoryFromMax(parseFloat($("#f_tmax").value))],
    TariffEncoded: $("#f_tariff").value,
    Acorn_LabelEncoded: 15,
    AcornGroup: $("#f_acorn").value,
  };

  const resultValue = $("#resultValue");
  const resultLabel = $("#resultLabel");
  resultValue.textContent = "…";
  resultLabel.textContent = "Predicting…";

  try {
    const res = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.error) {
      resultValue.textContent = "—";
      resultLabel.textContent = `Error: ${data.error}`;
      return;
    }
    resultValue.textContent = `${fmt(data.prediction_kwh)} kWh`;
    let comparison = "";
    if (OVERVIEW_DATA && OVERVIEW_DATA.avg_daily_kwh) {
      const diffPct = ((data.prediction_kwh - OVERVIEW_DATA.avg_daily_kwh) / OVERVIEW_DATA.avg_daily_kwh) * 100;
      comparison = diffPct > 3 ? `Expected demand is higher than the recent average (+${diffPct.toFixed(0)}%).`
        : diffPct < -3 ? `Expected demand is lower than the recent average (${diffPct.toFixed(0)}%).`
        : `In line with the recent average.`;
    }
    resultLabel.textContent = `${comparison} Range: ${fmt(data.lower_80)}–${fmt(data.upper_80)} kWh.`;
  } catch (e) {
    resultValue.textContent = "—";
    resultLabel.textContent = "Could not reach the backend.";
  }
}

/* ------------------------------------------------------------------ */
/* Init                                                                 */
/* ------------------------------------------------------------------ */
window.addEventListener("DOMContentLoaded", () => {
  setupNav();
  loadStatus();
  loadOverview();
  loadForecastChart();
  loadActualVsPredicted();
  loadWeatherChart();
  loadHourly();
  loadWeekdayWeekend();
  loadPeakOffpeak();
  loadMonthly();
  loadSegments();
  loadInsights();

  $("#f_date").value = new Date().toISOString().slice(0, 10);
  updateCalendarReadout();
  $("#f_date").addEventListener("change", updateCalendarReadout);
  $("#randomizeBtn").addEventListener("click", randomizeWeather);
  $("#predictForm").addEventListener("submit", submitPrediction);
  $("#modelDetailsToggle").addEventListener("click", toggleModelDetails);
  $("#jumpToPredict").addEventListener("click", (e) => {
    setTimeout(() => $("#predictBlock")?.scrollIntoView({ behavior: "smooth" }), 50);
  });

  window.addEventListener("resize", () => {
    renderForecastChart($("#fcHouseholdSelect").value);
    loadActualVsPredicted();
    loadWeatherChart();
    loadHourly();
    loadWeekdayWeekend();
    loadPeakOffpeak();
    loadMonthly();
    loadSegments();
  });
});
