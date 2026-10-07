/* ================================================================
   POTATO SENSE v4.0 — Smart Field Monitoring Dashboard
   script.js — Professional 2D Simulation Engine
   ================================================================ */

'use strict';

/* ----------------------------------------------------------------
   1. CONSTANTS & CONFIGURATION
   ---------------------------------------------------------------- */
const GRID_ROWS = 5;
const GRID_COLS = 5;
const TOTAL_SENSORS = GRID_ROWS * GRID_COLS;
const UPDATE_INTERVAL_MS = 5000;
const SIM_MINUTES_PER_TICK = 30;
const DAY_MINUTES = 24 * 60;

const HEALTHY_RANGES = {
  moisture: { min: 35, max: 65 },
  temperature: { min: 16, max: 28 },
  pH: { min: 5.8, max: 6.8 },
  humidity: { min: 45, max: 75 },
  battery: { min: 20, max: 100 },
  nitrogen: { min: 25, max: 75 },
  phosphorus: { min: 15, max: 55 },
  potassium: { min: 35, max: 85 },
};

const GROWTH_STAGES = ['Seedling', 'Vegetative', 'Flowering', 'Tuber Init', 'Maturity'];

const WEATHER_TYPES = {
  sunny: { tempBonus: +3, humidBonus: -5, evapRate: 2.5, label: '☀️ Sunny', rainChance: 0.01 },
  cloudy: { tempBonus: -1, humidBonus: +8, evapRate: 1.2, label: '⛅ Cloudy', rainChance: 0.12 },
  rain: { tempBonus: -4, humidBonus: +20, evapRate: 0.1, label: '🌧️ Rain', rainChance: 0.80, moisture: +10 },
  hot_wave: { tempBonus: +7, humidBonus: -10, evapRate: 4.0, label: '🥵 Heat Wave', rainChance: 0.00 },
  night: { tempBonus: -6, humidBonus: +5, evapRate: 0.5, label: '🌙 Night', rainChance: 0.05 },
};

const ALERT_TEMPLATES = [
  { id: 'low_moisture', severity: 'critical', icon: '💧', title: 'Low Soil Moisture', detail: 'Moisture below 30% — irrigation needed', metric: 'moisture', check: v => v < 30 },
  { id: 'high_moisture', severity: 'warning', icon: '🌊', title: 'Waterlogged Soil', detail: 'Moisture above 75% — root rot risk', metric: 'moisture', check: v => v > 75 },
  { id: 'high_temp', severity: 'critical', icon: '🌡️', title: 'Heat Stress', detail: 'Temperature > 30°C — tuber damage risk', metric: 'temperature', check: v => v > 30 },
  { id: 'low_temp', severity: 'warning', icon: '❄️', title: 'Cold Stress', detail: 'Temperature < 10°C — frost risk', metric: 'temperature', check: v => v < 10 },
  { id: 'acid_ph', severity: 'critical', icon: '⚗️', title: 'Acidic Soil', detail: 'pH < 5.5 — nutrient lockout', metric: 'pH', check: v => v < 5.5 },
  { id: 'alkaline_ph', severity: 'warning', icon: '⚗️', title: 'Alkaline Soil', detail: 'pH > 7.2 — iron deficiency risk', metric: 'pH', check: v => v > 7.2 },
  { id: 'low_battery', severity: 'warning', icon: '🔋', title: 'Low Battery', detail: 'Battery < 20% — sensor may go offline', metric: 'battery', check: v => v < 20 },
  { id: 'low_nitrogen', severity: 'warning', icon: '🌿', title: 'Nitrogen Deficiency', detail: 'N < 20 mg/kg — yellowing expected', metric: 'nitrogen', check: v => v < 20 },
  { id: 'low_potassium', severity: 'info', icon: '🥔', title: 'Low Potassium', detail: 'K < 30 mg/kg — tuber quality reduced', metric: 'potassium', check: v => v < 30 },
];

/* ----------------------------------------------------------------
   2. APPLICATION STATE
   ---------------------------------------------------------------- */
const state = {
  sensors: [],
  zones: [],
  alerts: [],
  clearedAlertIds: new Set(),
  charts: {},
  currentFilter: 'all',
  alertFilter: 'all',
  theme: 'dark',
  updateTimer: null,
  highlightedIdx: -1,
};

const env = {
  simMinute: 360,
  weather: 'sunny',
  weatherDuration: 0,
  irrigating: false,
  irrigationCells: [],
  irrigationTimer: 0,
  dayCount: 1,
  get dayHour() { return Math.floor(this.simMinute / 60) % 24; },
  get isDaytime() { return this.dayHour >= 6 && this.dayHour < 20; },
  get timeString() {
    const h = String(this.dayHour).padStart(2, '0');
    const m = String(this.simMinute % 60).padStart(2, '0');
    return `${h}:${m}`;
  },
};

/* ----------------------------------------------------------------
   3. ZONE-BASED FIELD GENERATOR
   ---------------------------------------------------------------- */
function gaussianWeight(dist, sigma = 1.8) {
  return Math.exp(-(dist * dist) / (2 * sigma * sigma));
}

function cellDist(r1, c1, r2, c2) {
  return Math.sqrt((r1 - r2) ** 2 + (c1 - c2) ** 2);
}

function generateZones() {
  const zones = [];
  const zoneTemplates = [
    { type: 'dry_patch', moisture: 18, temperature: +2, pH: 0, nutrient: -15, label: 'Dry Zone' },
    { type: 'wet_basin', moisture: 78, temperature: -1, pH: 0, nutrient: +10, label: 'Wet Zone' },
    { type: 'heat_pocket', moisture: -8, temperature: +5, pH: 0, nutrient: 0, label: 'Heat Zone' },
    { type: 'acid_patch', moisture: 0, temperature: 0, pH: -1.2, nutrient: -8, label: 'Acid Zone' },
    { type: 'fertile', moisture: +12, temperature: 0, pH: +0.2, nutrient: +20, label: 'Fertile Zone' },
    { type: 'cool_corner', moisture: +5, temperature: -4, pH: 0, nutrient: 0, label: 'Cool Zone' },
  ];
  const numZones = 3 + Math.floor(Math.random() * 2);
  const usedTemplates = shuffle([...zoneTemplates]).slice(0, numZones);
  usedTemplates.forEach(tmpl => {
    zones.push({
      ...tmpl,
      row: Math.random() * (GRID_ROWS - 1),
      col: Math.random() * (GRID_COLS - 1),
      sigma: 1.2 + Math.random() * 1.0,
      strength: 0.6 + Math.random() * 0.4,
    });
  });
  return zones;
}

function zoneBlendedValue(row0, col0, metric, baseline) {
  let totalWeight = 0; let weightedDelta = 0;
  state.zones.forEach(zone => {
    const dist = cellDist(row0 - 1, col0 - 1, zone.row, zone.col);
    const w = gaussianWeight(dist, zone.sigma) * zone.strength;
    const delta = zone[metric] || 0;
    weightedDelta += w * delta; totalWeight += w;
  });
  const blendedDelta = totalWeight > 0 ? weightedDelta : 0;
  return clamp(baseline + blendedDelta, ...metricBounds(metric));
}

function metricBounds(metric) {
  const bounds = { moisture: [5, 95], temperature: [5, 40], pH: [4.5, 8.5], nutrient: [0, 120] };
  return bounds[metric] || [0, 100];
}

function initSensors() {
  state.zones = generateZones();
  const BASE = { moisture: 48, temperature: 21, pH: 6.2 };

  state.sensors = Array.from({ length: TOTAL_SENSORS }, (_, i) => {
    const row = Math.floor(i / GRID_COLS) + 1;
    const col = (i % GRID_COLS) + 1;
    const id = `S-${String(i + 1).padStart(2, '0')}`;

    const moisture = zoneBlendedValue(row, col, 'moisture', BASE.moisture) + rand(-4, 4);
    const temperature = zoneBlendedValue(row, col, 'temperature', BASE.temperature) + rand(-1.5, 1.5);
    const pH = zoneBlendedValue(row, col, 'pH', BASE.pH) + rand(-0.15, 0.15, 2);
    const nutrientBias = zoneBlendedValue(row, col, 'nutrient', 50);
    const humidity = clamp(55 - (100 - moisture) * 0.2 + rand(-5, 5), 20, 95);
    const light = env.isDaytime ? rand(15000, 85000, 0) : rand(0, 500, 0);
    const battery = rand(55, 100, 0);
    const nitrogen = clamp(nutrientBias * 0.8 + rand(-5, 5), 5, 100);
    const phosphorus = clamp(nutrientBias * 0.6 + rand(-5, 5), 3, 80);
    const potassium = clamp(nutrientBias + rand(-5, 5), 10, 120);

    const growthStageIdx = Math.floor(Math.random() * GROWTH_STAGES.length);
    const sensor = {
      index: i, id, row, col,
      moisture: clamp(moisture, 5, 95), temperature: clamp(temperature, 5, 40), pH: clamp(pH, 4.5, 8.5),
      humidity, light, battery, nitrogen, phosphorus, potassium,
      growthStageIdx, plantAge: rand(10, 80, 0),
      lastUpdate: new Date(),
      firmware: `v${randi(1, 3)}.${randi(0, 9)}.${randi(0, 15)}`, signalStrength: randi(50, 100), uptime: `${randi(1, 720)}h`,
      plantHealth: 0, status: 'healthy',
      isOnline: true,
      isReal: (i === 0), // S-01 is real, all others are simulated
    };
    sensor.plantHealth = computePlantHealth(sensor);
    sensor.status = determineSensorStatus(sensor);
    return sensor;
  });
}

/* ----------------------------------------------------------------
   4. PHYSICS ENGINE
   ---------------------------------------------------------------- */
function tickEnvironment() {
  env.simMinute = (env.simMinute + SIM_MINUTES_PER_TICK) % DAY_MINUTES;
  if (env.simMinute === 0) env.dayCount++;

  if (env.weatherDuration <= 0) {
    env.weather = pickNextWeather();
    env.weatherDuration = randi(3, 10);
  } else {
    env.weatherDuration--;
    if (!env.isDaytime) env.weather = 'night';
    else if (env.weather === 'night') env.weather = 'sunny';
  }

  const avgMoisture = state.sensors.reduce((s, x) => s + x.moisture, 0) / TOTAL_SENSORS;
  if (!env.irrigating && avgMoisture < 28) {
    env.irrigating = true;
    env.irrigationTimer = randi(4, 8);
    env.irrigationCells = state.sensors.filter(s => s.moisture < 30).map(s => s.index);
    showToast(`💧 Auto-irrigation triggered — ${env.irrigationCells.length} zones`, 'info');
  }
  if (env.irrigating && env.irrigationTimer-- <= 0) {
    env.irrigating = false; env.irrigationCells = [];
    showToast('✅ Irrigation cycle complete', 'success');
  }
}

function pickNextWeather() {
  const current = WEATHER_TYPES[env.weather];
  const roll = Math.random();
  if (!env.isDaytime) return 'night';
  if (roll < current.rainChance) return 'rain';
  if (roll < 0.04) return 'hot_wave';
  if (roll < 0.25) return 'cloudy';
  return 'sunny';
}

function tickSensors() {
  const w = WEATHER_TYPES[env.weather];
  const dailyCurve = Math.sin((env.simMinute / DAY_MINUTES) * Math.PI * 2 - Math.PI / 2);
  const globalTempOffset = dailyCurve * 5 + (w.tempBonus || 0);

  state.sensors = state.sensors.map(s => {
    if (!s.isOnline) {
      return s; // Offline sensors do not update
    }

    if (s.isReal) {
      // Real sensors do not get simulated environmental updates, 
      // but we do update their derived health/status metrics
      s.plantHealth = computePlantHealth(s);
      s.status = determineSensorStatus(s);
      
      // Local simulation: occasionally log a message to show the UI functions
      if (!wsConnected && s.id === 'S-01' && Math.random() < 0.3) {
        appendS01Message(Math.random() < 0.5 ? 'hello' : 'system_test_ok');
      }
      return s;
    }

    let moisture = s.moisture;
    const sun = env.isDaytime ? 1.4 : 0.5;
    moisture -= (w.evapRate + s.temperature * 0.04) * sun * 0.3;
    if (env.weather === 'rain') moisture += rand(3, 12);
    if (env.irrigating && env.irrigationCells.includes(s.index)) moisture += rand(6, 14);

    const neighbors = getNeighborIndices(s.row, s.col);
    if (neighbors.length > 0) {
      const avgN = neighbors.reduce((sum, idx) => sum + state.sensors[idx].moisture, 0) / neighbors.length;
      moisture = moisture * 0.88 + avgN * 0.12;
    }
    moisture = clamp(moisture, 2, 98);

    const zoneBase = zoneBlendedValue(s.row, s.col, 'temperature', 21);
    let temperature = clamp(zoneBase + globalTempOffset + rand(-0.8, 0.8), 3, 42);
    const pH = clamp(s.pH + rand(-0.03, 0.03, 2), 4.5, 8.5);
    const humidity = clamp(60 + (w.humidBonus || 0) - (100 - moisture) * 0.18 + rand(-3, 3), 15, 98);
    const light = env.isDaytime ? clamp(s.light + rand(-3000, 3000, 0), 1000, 100000) : clamp(s.light * 0.3, 0, 400);
    const battery = Math.max(5, s.battery - rand(0, 0.15));
    const uptake = moisture > 35 ? 0.08 : 0.02;

    const updated = {
      ...s, moisture, temperature, pH, humidity, light,
      battery: parseFloat(battery.toFixed(0)),
      nitrogen: clamp(s.nitrogen - rand(0, uptake), 2, 100),
      phosphorus: clamp(s.phosphorus - rand(0, uptake * 0.6), 1, 80),
      potassium: clamp(s.potassium - rand(0, uptake * 0.8), 5, 120),
      lastUpdate: new Date(),
    };
    updated.plantHealth = computePlantHealth(updated);
    updated.status = determineSensorStatus(updated);
    return updated;
  });
}

function getNeighborIndices(row, col) {
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  return dirs.map(([dr, dc]) => {
    const r = row + dr, c = col + dc;
    if (r < 1 || r > GRID_ROWS || c < 1 || c > GRID_COLS) return null;
    return (r - 1) * GRID_COLS + (c - 1);
  }).filter(i => i !== null);
}

function computePlantHealth(s) {
  const mScore = scoreFactor(s.moisture, 35, 65, 5, 90);
  const tScore = scoreFactor(s.temperature, 16, 28, 5, 35);
  const pScore = scoreFactor(s.pH, 5.8, 6.8, 4.5, 8.0);
  const minScore = Math.min(mScore, tScore, pScore);
  return parseFloat((minScore * 0.5 + ((s.nitrogen / 75 * 100) + (s.potassium / 85 * 100)) / 2 * 0.3 + mScore * 0.2).toFixed(1));
}

function scoreFactor(val, optMin, optMax, hardMin, hardMax) {
  if (val < hardMin || val > hardMax) return 0;
  if (val >= optMin && val <= optMax) return 100;
  if (val < optMin) return clamp(((val - hardMin) / (optMin - hardMin)) * 100, 0, 100);
  return clamp(((hardMax - val) / (hardMax - optMax)) * 100, 0, 100);
}

function determineSensorStatus(s) {
  if (s.isOnline === false) return 'offline';
  if (s.plantHealth < 25 || s.moisture < 15 || s.moisture > 85 || s.temperature > 35 || s.temperature < 8 || s.pH < 5.0 || s.pH > 7.8 || s.battery < 10) return 'critical';
  if (s.plantHealth < 60 || s.moisture < 30 || s.moisture > 72 || s.temperature > 30 || s.temperature < 13 || s.pH < 5.5 || s.pH > 7.2 || s.battery < 20) return 'warning';
  return 'healthy';
}

function growthStageLabel(s) { return GROWTH_STAGES[s.growthStageIdx % GROWTH_STAGES.length]; }

/* ----------------------------------------------------------------
   5. SOIL & PLANT VISUALS (2D)
   ---------------------------------------------------------------- */
function soilGradient(moisture) {
  if (moisture < 15) return 'linear-gradient(145deg, #c8a870 0%, #b8956a 40%, #a07848 100%)';
  if (moisture < 30) return 'linear-gradient(145deg, #a07848 0%, #8a6438 40%, #7a5730 100%)';
  if (moisture < 55) return 'linear-gradient(145deg, #7a5730 0%, #6a4822 40%, #5a3d1c 100%)';
  if (moisture < 72) return 'linear-gradient(145deg, #5a3d1c 0%, #4a3215 40%, #3a2510 100%)';
  return 'linear-gradient(145deg, #3a2510 0%, #2a1a0c 40%, #1f1208 100%)';
}

function plantEmoji(health, isIrrigating) {
  const op = health > 60 ? '0.85' : health > 30 ? '0.6' : '0.4';
  const irrigAnim = isIrrigating ? '<circle cx="12" cy="12" r="10" stroke="var(--cyan)" stroke-width="1.5" stroke-dasharray="4 6"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="4s" repeatCount="indefinite"/></circle>' : '<circle cx="12" cy="12" r="10" stroke-opacity="0.25" stroke-dasharray="2 4" />';

  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width: 28px; height: 28px; opacity: ${op}; color: inherit;">
      ${irrigAnim}
      <!-- Ground reference line -->
      <line x1="5" y1="14" x2="19" y2="14" stroke-opacity="0.4" stroke-dasharray="1 2" />
      
      <!-- Subterranean Biomass Nodes (Tubers) -->
      <circle cx="12" cy="17.5" r="2.5" fill="currentColor" fill-opacity="0.8" stroke="none" />
      <circle cx="8.5" cy="18.5" r="1.5" fill="currentColor" fill-opacity="0.5" stroke="none" />
      <circle cx="15.5" cy="16.5" r="1.8" fill="currentColor" fill-opacity="0.5" stroke="none" />
      
      <!-- Surface Biomass (Stem & Leaves) -->
      <path d="M12 14 V5" stroke-linecap="round" />
      <path d="M12 10 Q8.5 8.5 7 7" stroke-linecap="round" />
      <path d="M12 7 Q15.5 5.5 17 4" stroke-linecap="round" />
      
      ${isIrrigating ? '<path d="M16 10 C16 11.1 15.1 12 14 12 C12.9 12 12 11.1 12 10 C12 8.5 14 7 14 7 C14 7 16 8.5 16 10 Z" fill="var(--cyan)" fill-opacity="0.7" stroke="none" />' : ''}
    </svg>
  `;
}

function statusColorHex(status) {
  if (status === 'healthy') return 'var(--green)';
  if (status === 'warning') return 'var(--yellow)';
  return 'var(--red)';
}

/* ----------------------------------------------------------------
   6. 2D FIELD GRID RENDERER
   ---------------------------------------------------------------- */
function renderFieldGrid() {
  const container = document.getElementById('field-grid-main');
  if (!container) return;
  container.innerHTML = '';

  state.sensors.forEach((sensor, i) => {
    const isIrrig = env.irrigating && env.irrigationCells.includes(sensor.index);
    const isFiltered = state.currentFilter !== 'all' && sensor.status !== state.currentFilter;

    const cell = document.createElement('div');
    cell.className = 'plot-cell';
    if (state.highlightedIdx === i) cell.classList.add('highlighted');
    cell.style.background = soilGradient(sensor.moisture);
    cell.style.opacity = isFiltered ? '0.25' : '1';
    cell.style.animationDelay = `${i * 30}ms`;

    if (isIrrig) {
      cell.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3), inset 0 0 15px rgba(6,182,212,0.2), 0 0 12px rgba(6,182,212,0.25)';
    }

    if (!sensor.isOnline) {
      cell.style.opacity = '0.4';
      cell.style.background = 'rgba(255,255,255,0.02)';
      cell.style.border = '1px dashed rgba(255,255,255,0.1)';
      cell.innerHTML = `
        <span class="plot-id" style="color: var(--text-muted);">${sensor.id}</span>
        <div style="display:flex;align-items:center;justify-content:center;height:100%;font-weight:700;color:var(--text-muted);font-size:0.7rem;text-transform:uppercase;letter-spacing:1px;position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;">OFFLINE</div>
      `;
    } else {
      cell.innerHTML = `
        <span class="plot-id">${sensor.id}</span>
        ${sensor.isReal ? '<span class="plot-badge real-badge" style="position:absolute;top:4px;right:6px;font-size:0.5rem;font-family:var(--font-mono);font-weight:700;color:var(--green);border:1px solid var(--green-border);background:var(--green-dim);padding:1px 4px;border-radius:2px;z-index:10;letter-spacing:0.5px;">LIVE</span>' : ''}
        <span class="plot-plant">${plantEmoji(sensor.plantHealth, isIrrig)}</span>
        <div class="plot-health-bar">
          <div class="plot-health-fill" style="width:${sensor.plantHealth}%; background:${healthColor(sensor.plantHealth)}; color:${healthColor(sensor.plantHealth)};"></div>
        </div>
        <span class="plot-temp">${sensor.temperature.toFixed(0)}°</span>
        <span class="plot-status-ring" style="color:${statusColorHex(sensor.status)}; background: currentColor;"></span>
      `;
    }
    cell.onclick = () => openSensorModal(sensor.index);
    container.appendChild(cell);
  });

  // Update timestamp
  const ts = document.getElementById('grid-timestamp');
  if (ts) ts.textContent = `Day ${env.dayCount} · ${env.timeString}`;
}

/* ----------------------------------------------------------------
   7. FIELD INTELLIGENCE
   ---------------------------------------------------------------- */
function renderFieldIntelligence() {
  const elIrrig = document.getElementById('intel-irrigation');
  if (elIrrig) {
    const dry = state.sensors.filter(s => s.moisture < 35).sort((a, b) => a.moisture - b.moisture);
    if (dry.length === 0) elIrrig.innerHTML = `<div class="intel-ok">✅ All zones adequately irrigated</div>`;
    else elIrrig.innerHTML = dry.map(s => `
      <div class="intel-row ${s.moisture < 22 ? 'intel-critical' : 'intel-warn'}" onclick="openSensorModal(${s.index})">
        <span class="intel-id">${s.id}</span>
        <span class="intel-bar-wrap"><span class="intel-bar" style="width:${s.moisture}%;background:${s.moisture < 22 ? 'var(--red)' : 'var(--yellow)'}"></span></span>
        <span class="intel-val">${s.moisture.toFixed(0)}%</span>
      </div>
    `).join('');
  }

  const elPh = document.getElementById('intel-ph');
  if (elPh) {
    const bad = state.sensors.filter(s => s.pH < 5.5 || s.pH > 7.2).sort((a, b) => a.pH - b.pH);
    if (bad.length === 0) elPh.innerHTML = `<div class="intel-ok">✅ pH levels normal across field</div>`;
    else elPh.innerHTML = bad.map(s => `
      <div class="intel-row ${s.pH < 5.5 ? 'intel-critical' : 'intel-warn'}" onclick="openSensorModal(${s.index})">
        <span class="intel-id">${s.id}</span>
        <span class="intel-bar-wrap"><span class="intel-bar" style="width:${((s.pH - 4) / 5) * 100}%;background:var(--purple)"></span></span>
        <span class="intel-val">${s.pH.toFixed(2)}</span>
      </div>`).join('');
  }

  const elCrop = document.getElementById('intel-crop');
  if (elCrop) {
    const avgHealth = state.sensors.reduce((s, x) => s + x.plantHealth, 0) / TOTAL_SENSORS;
    const circ = 188.5;
    elCrop.innerHTML = `
      <div class="intel-avg-health">
        <div class="intel-gauge">
          <svg viewBox="0 0 80 80" width="72" height="72">
            <circle cx="40" cy="40" r="30" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="7"/>
            <circle cx="40" cy="40" r="30" fill="none" stroke="${healthColor(avgHealth)}" stroke-width="7"
              stroke-dasharray="${(avgHealth / 100 * circ).toFixed(1)} ${circ}" stroke-linecap="round" transform="rotate(-90 40 40)"/>
          </svg>
          <div class="intel-gauge-label" style="margin-top:-48px; font-size:1.1rem; font-weight:800; color:${healthColor(avgHealth)}; text-align:center;">${avgHealth.toFixed(0)}%</div>
        </div>
        <div class="intel-gauge-meta">
          <div>🌱 Healthy: <strong>${state.sensors.filter(s => s.plantHealth >= 70).length}</strong></div>
          <div>⚠️ Stressed: <strong>${state.sensors.filter(s => s.plantHealth >= 40 && s.plantHealth < 70).length}</strong></div>
          <div>🚨 Critical: <strong>${state.sensors.filter(s => s.plantHealth < 40).length}</strong></div>
        </div>
      </div>
    `;
  }
}

function updateEnvBar() {
  const el = document.getElementById('env-bar');
  if (!el) return;
  const w = WEATHER_TYPES[env.weather];
  const avgT = (state.sensors.reduce((s, x) => s + x.temperature, 0) / TOTAL_SENSORS).toFixed(1);
  el.innerHTML = `
    <span class="env-item">${w.label}</span><span class="env-sep">|</span>
    <span class="env-item">🕐 ${env.timeString} — Day ${env.dayCount}</span><span class="env-sep">|</span>
    <span class="env-item">🌡️ ${avgT}°C avg</span><span class="env-sep">|</span>
    <span class="env-item ${env.irrigating ? 'env-irrigating' : ''}">${env.irrigating ? '💧 Irrigating' : '🌱 Normal ops'}</span>
  `;

  // Update sidebar environment
  const weatherEl = document.getElementById('env-weather-mini');
  if (weatherEl) weatherEl.textContent = w.label;

  const dayFill = document.getElementById('day-fill');
  if (dayFill) {
    const dayProgress = env.isDaytime ? ((env.simMinute - 360) / (1200 - 360)) * 100 : (env.simMinute < 360 ? 0 : 100);
    dayFill.style.width = `${clamp(dayProgress, 0, 100)}%`;
  }
}

/* ----------------------------------------------------------------
   8. STATISTICS & CHARTS
   ---------------------------------------------------------------- */
function updateStatistics() {
  const sensors = state.sensors;
  setTextAnim('stat-total-val', TOTAL_SENSORS);
  setTextAnim('stat-healthy-val', sensors.filter(s => s.status === 'healthy').length);
  setTextAnim('stat-warning-val', sensors.filter(s => s.status === 'warning').length);
  setTextAnim('stat-critical-val', sensors.filter(s => s.status === 'critical').length);
  setText('stat-temp-val', `${(sensors.reduce((s, x) => s + x.temperature, 0) / sensors.length).toFixed(1)}°C`);
  setText('stat-moisture-val', `${(sensors.reduce((s, x) => s + x.moisture, 0) / sensors.length).toFixed(1)}%`);
  setText('stat-ph-val', (sensors.reduce((s, x) => s + x.pH, 0) / sensors.length).toFixed(2));
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setTextAnim(id, target) {
  const el = document.getElementById(id); if (!el) return;
  const curr = parseInt(el.textContent) || 0; if (curr === target) return;
  let val = curr; const step = (target - curr) / 8;
  const int = setInterval(() => {
    val += step;
    if ((step > 0 && val >= target) || (step < 0 && val <= target)) { val = target; clearInterval(int); }
    el.textContent = Math.round(val);
  }, 30);
}

function initCharts() {
  if (typeof Chart === 'undefined') return;
  const s = state.sensors;
  const labels = s.map(x => x.id);
  const chartFont = { family: "'Inter', sans-serif" };
  const gridColor = 'rgba(148,163,184,0.08)';
  const tickColor = '#64748b';

  const opts = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { labels: { color: tickColor, font: { ...chartFont, weight: 600, size: 11 } } },
      tooltip: {
        backgroundColor: 'rgba(15,23,42,0.9)',
        titleFont: { ...chartFont, weight: 700 },
        bodyFont: chartFont,
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 10,
      },
    },
    scales: {
      x: { ticks: { color: tickColor, font: { ...chartFont, size: 10 } }, grid: { color: gridColor } },
      y: { ticks: { color: tickColor, font: { ...chartFont, size: 10 } }, grid: { color: gridColor } },
    },
  };

  const ctxT = document.getElementById('chart-temperature');
  if (ctxT && !state.charts.t) {
    state.charts.t = new Chart(ctxT, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Temp °C', data: s.map(x => x.temperature), backgroundColor: 'rgba(245,158,11,0.7)', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 6 }] },
      options: opts,
    });
  }

  const ctxM = document.getElementById('chart-moisture');
  if (ctxM && !state.charts.m) {
    state.charts.m = new Chart(ctxM, {
      type: 'line',
      data: { labels, datasets: [{ label: 'Moisture %', data: s.map(x => x.moisture), backgroundColor: 'rgba(6,182,212,0.15)', borderColor: '#06b6d4', borderWidth: 2, tension: 0.4, fill: true, pointRadius: 3, pointBackgroundColor: '#06b6d4' }] },
      options: opts,
    });
  }

  const ctxPh = document.getElementById('chart-ph');
  if (ctxPh && !state.charts.ph) {
    state.charts.ph = new Chart(ctxPh, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Soil pH', data: s.map(x => x.pH), backgroundColor: 'rgba(139,92,246,0.7)', borderColor: '#8b5cf6', borderWidth: 1, borderRadius: 6 }] },
      options: opts,
    });
  }
}

function updateChartsData() {
  if (typeof Chart === 'undefined') return;
  const s = state.sensors;
  if (state.charts.t) { state.charts.t.data.datasets[0].data = s.map(x => x.temperature); state.charts.t.update('none'); }
  if (state.charts.m) { state.charts.m.data.datasets[0].data = s.map(x => x.moisture); state.charts.m.update('none'); }
  if (state.charts.ph) { state.charts.ph.data.datasets[0].data = s.map(x => x.pH); state.charts.ph.update('none'); }
}

/* ----------------------------------------------------------------
   9. HEATMAP
   ---------------------------------------------------------------- */
function renderHeatmap() {
  const container = document.getElementById('heatmap-grid');
  if (!container) return;
  container.innerHTML = '';
  state.sensors.forEach(sensor => {
    const cell = document.createElement('div');
    cell.className = 'heatmap-cell';
    const hue = (sensor.moisture / 100 * 120).toFixed(0);
    cell.style.background = `linear-gradient(145deg, hsl(${hue},65%,${30 + sensor.moisture * 0.12}%), hsl(${hue},55%,${25 + sensor.moisture * 0.1}%))`;
    cell.innerHTML = `<span class="hm-id">${sensor.id}</span><span class="hm-val">${sensor.moisture.toFixed(0)}%</span>`;
    cell.onclick = () => openSensorModal(sensor.index);
    container.appendChild(cell);
  });

  const statsEl = document.getElementById('heatmap-stats');
  if (statsEl) {
    const avg = state.sensors.reduce((s, x) => s + x.moisture, 0) / TOTAL_SENSORS;
    const min = Math.min(...state.sensors.map(s => s.moisture));
    const max = Math.max(...state.sensors.map(s => s.moisture));
    statsEl.innerHTML = `
      <span>Min: <strong>${min.toFixed(1)}%</strong></span>
      <span>Avg: <strong>${avg.toFixed(1)}%</strong></span>
      <span>Max: <strong>${max.toFixed(1)}%</strong></span>
    `;
  }
}

/* ----------------------------------------------------------------
   10. ALERTS
   ---------------------------------------------------------------- */
function generateAlerts() {
  const now = new Date();
  const alerts = [];
  state.sensors.forEach(sensor => {
    ALERT_TEMPLATES.forEach(t => {
      if (t.check(sensor[t.metric])) {
        const id = `${t.id}_${sensor.id}`;
        if (!state.clearedAlertIds.has(id)) {
          alerts.push({ id, sensor: sensor.id, sensorIdx: sensor.index, severity: t.severity, icon: t.icon, title: t.title, detail: t.detail, time: now });
        }
      }
    });
  });
  alerts.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - ({ critical: 0, warning: 1, info: 2 }[b.severity])));
  state.alerts = alerts;
  const badge = document.getElementById('alert-count-badge');
  if (badge) badge.textContent = alerts.filter(a => a.severity !== 'info').length;
}

function renderMiniAlerts() {
  const c = document.getElementById('alerts-mini-list');
  if (!c) return;
  const top = state.alerts.slice(0, 6);
  if (top.length === 0) c.innerHTML = `<div class="no-alerts">✅ System Normal — No Active Alerts</div>`;
  else c.innerHTML = top.map(a => `
    <div class="alert-mini-item" onclick="openSensorModal(${a.sensorIdx})">
      <span class="alert-dot ${a.severity}"></span>
      <div class="alert-mini-body"><div class="alert-mini-msg">${a.icon} ${a.title}</div><div class="alert-mini-meta">${a.sensor}</div></div>
    </div>`).join('');
}

function renderFullAlertsList() {
  const container = document.getElementById('alerts-full-list');
  if (!container) return;
  const filtered = state.alerts.filter(a => state.alertFilter === 'all' || a.severity === state.alertFilter);
  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-secondary); font-size: 0.9rem;">✅ No active alerts matching filter.</div>`;
    return;
  }
  container.innerHTML = filtered.map(a => `
    <div class="alert-item" onclick="openSensorModal(${a.sensorIdx})">
      <div class="alert-icon" style="color: ${severityColor(a.severity)}; background: ${a.severity === 'critical' ? 'var(--red-dim)' : a.severity === 'warning' ? 'var(--yellow-dim)' : 'var(--blue-dim)'}">${a.icon}</div>
      <div style="flex: 1">
        <div class="alert-title" style="color: ${severityColor(a.severity)}">${a.title} — ${a.sensor}</div>
        <div class="alert-detail">${a.detail}</div>
      </div>
      <div style="font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-mono);">${a.time.toLocaleTimeString()}</div>
    </div>
  `).join('');
}

function filterAlerts(severity, btn) {
  state.alertFilter = severity;
  document.querySelectorAll('.alert-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderFullAlertsList();
}

function clearAlerts() {
  state.alerts.forEach(a => state.clearedAlertIds.add(a.id));
  state.alerts = [];
  const badge = document.getElementById('alert-count-badge');
  if (badge) badge.textContent = '0';
  renderMiniAlerts();
  renderFullAlertsList();
  showToast('All active alerts cleared', 'success');
}

/* ----------------------------------------------------------------
   11. DETAILED GRID VIEW
   ---------------------------------------------------------------- */
let currentGridMode = 'status';

function switchGridMode(mode) {
  currentGridMode = mode;
  renderFullFieldGrid();
}

function renderFullFieldGrid() {
  const container = document.getElementById('full-field-grid');
  if (!container) return;
  container.innerHTML = '';

  state.sensors.forEach(sensor => {
    const cell = document.createElement('div');
    cell.className = 'detailed-cell';

    let valStr = '', valCol = '#fff', label = '';

    switch (currentGridMode) {
      case 'status':
        valStr = `${sensor.plantHealth.toFixed(1)}%`;
        valCol = healthColor(sensor.plantHealth);
        label = 'Health';
        break;
      case 'moisture':
        valStr = `${sensor.moisture.toFixed(1)}%`;
        valCol = moistureColor(sensor.moisture);
        label = 'Moisture';
        break;
      case 'temperature':
        valStr = `${sensor.temperature.toFixed(1)}°C`;
        valCol = tempColor(sensor.temperature);
        label = 'Temp';
        break;
      case 'battery':
        valStr = `${sensor.battery}%`;
        valCol = batteryColor(sensor.battery);
        label = 'Battery';
        break;
      case 'ph':
        valStr = sensor.pH.toFixed(2);
        valCol = phColor(sensor.pH);
        label = 'Soil pH';
        break;
    }

    if (!sensor.isOnline) {
      valStr = 'OFF';
      valCol = 'var(--text-muted)';
      cell.style.opacity = '0.5';
      cell.style.background = 'rgba(255,255,255,0.02)';
      cell.style.border = '1px dashed rgba(255,255,255,0.1)';
    }

    cell.innerHTML = `
      <span class="detailed-id" style="color: ${!sensor.isOnline ? 'var(--text-muted)' : ''}">${sensor.id}</span>
      ${sensor.isReal ? '<span class="detailed-badge" style="position:absolute;bottom:6px;right:8px;font-size:0.55rem;font-family:var(--font-mono);font-weight:700;color:var(--green);border:1px solid var(--green-border);background:var(--green-dim);padding:2px 5px;border-radius:2px;letter-spacing:0.5px;">LIVE DEVICE</span>' : '<span class="detailed-badge" style="position:absolute;bottom:6px;right:8px;font-size:0.55rem;font-family:var(--font-mono);font-weight:600;color:var(--text-muted);border:1px solid var(--border-color);background:var(--bg-input);padding:2px 5px;border-radius:2px;letter-spacing:0.5px;">SIMULATED</span>'}
      <span class="detailed-label">${label}</span>
      <span class="detailed-value" style="color: ${valCol}">${valStr}</span>
      <span class="detailed-status-dot" style="color: ${statusColorHex(sensor.status)}; background: currentColor; ${!sensor.isOnline ? 'box-shadow: none;' : ''}"></span>
    `;
    cell.onclick = () => openSensorModal(sensor.index);
    container.appendChild(cell);
  });
}

/* ----------------------------------------------------------------
   12. MODAL
   ---------------------------------------------------------------- */
function openSensorModal(index) {
  state.currentModalSensorIndex = index;
  const s = state.sensors[index];
  if (!s) return;
  setText('modal-sensor-badge', s.id);
  setText('modal-sensor-title', `Sensor ${s.id}`);
  setText('modal-position', `Row ${s.row}, Column ${s.col}`);
  const sb = document.getElementById('modal-status-badge');
  if (sb) { sb.textContent = s.status.toUpperCase(); sb.className = `modal-status-badge ${s.status}`; }

  const btn = document.getElementById('modal-power-btn');
  if (btn) {
    if (s.isOnline) {
      btn.textContent = 'ON';
      btn.style.background = 'rgba(16, 185, 129, 0.15)';
      btn.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      btn.style.color = 'var(--green)';
    } else {
      btn.textContent = 'OFF';
      btn.style.background = 'rgba(239, 68, 68, 0.15)';
      btn.style.borderColor = 'rgba(239, 68, 68, 0.3)';
      btn.style.color = 'var(--red)';
    }
  }

  const overlay = document.getElementById('modal-offline-overlay');
  if (overlay) {
    overlay.style.display = s.isOnline ? 'none' : 'flex';
  }

  const hp = s.plantHealth;
  const circ = 188.5;
  document.getElementById('modal-plant-visual').innerHTML = `
    <div class="modal-plant-ring">
      <svg viewBox="0 0 80 80" width="100" height="100" style="transform:rotate(-90deg)"><circle cx="40" cy="40" r="30" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="6"/><circle cx="40" cy="40" r="30" fill="none" stroke="${healthColor(hp)}" stroke-width="6" stroke-dasharray="${(hp / 100 * circ).toFixed(1)} ${circ}" stroke-linecap="round"/></svg>
      <div style="position:absolute; font-size:1.4rem; font-weight:800; color:${healthColor(hp)};">${hp.toFixed(0)}%</div>
    </div>
    <div class="modal-plant-stage"><div class="stage-label">Growth Stage</div><div class="stage-value">${growthStageLabel(s)}</div><div class="stage-bar">${GROWTH_STAGES.map((g, i) => `<span class="stage-pip ${i <= s.growthStageIdx ? 'active' : ''}"></span>`).join('')}</div></div>
  `;

  const rGrid = document.getElementById('modal-readings-grid');
  if (rGrid) {
    const readings = [
      { icon: '💧', label: 'Moisture', val: `${s.moisture.toFixed(1)}%`, pct: s.moisture, col: moistureColor(s.moisture) },
      { icon: '🌡️', label: 'Temp', val: `${s.temperature.toFixed(1)}°C`, pct: (s.temperature / 40) * 100, col: tempColor(s.temperature) },
      { icon: '⚗️', label: 'pH', val: s.pH.toFixed(2), pct: (s.pH / 14) * 100, col: phColor(s.pH) },
      { icon: '💨', label: 'Humidity', val: `${s.humidity.toFixed(1)}%`, pct: s.humidity, col: '#06b6d4' },
      { icon: '🔋', label: 'Battery', val: `${s.battery}%`, pct: s.battery, col: batteryColor(s.battery) },
    ];
    rGrid.innerHTML = readings.map(r => `
      <div class="reading-card">
        <div class="reading-gauge"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="30" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="5"/><circle cx="40" cy="40" r="30" fill="none" stroke="${r.col}" stroke-width="5" stroke-dasharray="${(r.pct / 100 * circ).toFixed(1)} ${circ}" stroke-linecap="round"/></svg><div class="reading-icon">${r.icon}</div></div>
        <div class="reading-label">${r.label}</div><div class="reading-value" style="color:${r.col}">${r.val}</div>
      </div>`).join('');
  }

  const nGrid = document.getElementById('modal-npk');
  if (nGrid) nGrid.innerHTML = [
    { l: 'Nitrogen (N)', v: s.nitrogen, m: 100, c: '#10b981' }, { l: 'Phosphorus (P)', v: s.phosphorus, m: 80, c: '#3b82f6' }, { l: 'Potassium (K)', v: s.potassium, m: 120, c: '#f59e0b' }
  ].map(n => `<div class="npk-item"><div class="npk-header"><span class="npk-label">${n.l}</span><span class="npk-value">${n.v.toFixed(1)} mg/kg</span></div><div class="npk-track"><div class="npk-fill" style="width:${(n.v / n.m) * 100}%;background:${n.c};color:${n.c}"></div></div></div>`).join('');

  const iGrid = document.getElementById('modal-info-grid');
  if (iGrid) iGrid.innerHTML = [
    { l: 'Firmware', v: s.firmware }, { l: 'Signal', v: `${s.signalStrength}%` },
    { l: 'Uptime', v: s.uptime }, { l: 'Light', v: `${s.light.toLocaleString()} lux` },
    { l: 'Last Update', v: s.lastUpdate.toLocaleTimeString() }, { l: 'Plant Age', v: `${s.plantAge} days` },
  ].map(r => `<div class="info-row"><span class="info-row-label">${r.l}</span><span class="info-row-value">${r.v}</span></div>`).join('');

  document.getElementById('modal-overlay').classList.add('open');
}

function closeSensorModal() { document.getElementById('modal-overlay').classList.remove('open'); }
function closeModal(e) { if (e.target === document.getElementById('modal-overlay')) closeSensorModal(); }

/* ----------------------------------------------------------------
   13. INTERACTIVE CONTROLS
   ---------------------------------------------------------------- */
function showSection(name, btn) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const sec = document.getElementById(`section-${name}`);
  if (sec) sec.classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (name === 'heatmap') renderHeatmap();
  if (name === 'charts') initCharts();
  if (name === 'field-grid') renderFullFieldGrid();
  if (name === 'alerts') renderFullAlertsList();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('collapsed');
}

function toggleTheme() {
  const htmlEl = document.documentElement;
  const newTheme = htmlEl.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  htmlEl.setAttribute('data-theme', newTheme);
  state.theme = newTheme;

  const sunIcon = document.getElementById('theme-icon-sun');
  const moonIcon = document.getElementById('theme-icon-moon');
  if (newTheme === 'light') {
    if (sunIcon) sunIcon.style.display = 'block';
    if (moonIcon) moonIcon.style.display = 'none';
  } else {
    if (sunIcon) sunIcon.style.display = 'none';
    if (moonIcon) moonIcon.style.display = 'block';
  }
  showToast(`Switched to ${newTheme} theme`, 'info');
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => { });
  } else {
    document.exitFullscreen();
  }
}

function exportToJSON() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.sensors, null, 2));
  const a = document.createElement('a');
  a.setAttribute("href", dataStr);
  a.setAttribute("download", `potatosense_data_${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast('📥 Sensor data exported', 'success');
}

function searchSensor(query) {
  if (!query || query.trim().length === 0) {
    state.highlightedIdx = -1;
    renderFieldGrid();
    return;
  }
  const q = query.trim().toUpperCase();
  const sensor = state.sensors.find(s =>
    s.id === q || s.id.includes(q) || s.id.replace('S-', '').replace(/^0+/, '') === q.replace('S-', '').replace(/^0+/, '')
  );
  if (sensor) {
    state.highlightedIdx = sensor.index;
    renderFieldGrid();
  }
}

function filterByStatus(status) {
  state.currentFilter = status;
  renderFieldGrid();
}

function showToast(msg, type = 'info') {
  const tc = document.getElementById('toast-container');
  if (!tc) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  tc.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(10px)'; setTimeout(() => t.remove(), 300); }, 3000);
}

/* ----------------------------------------------------------------
   14. UTILITY FUNCTIONS
   ---------------------------------------------------------------- */
function healthColor(v) { return v > 70 ? '#10b981' : v > 40 ? '#f59e0b' : '#ef4444'; }
function moistureColor(v) { return v < 20 ? '#ef4444' : v < 35 ? '#f59e0b' : v <= 65 ? '#10b981' : '#06b6d4'; }
function tempColor(v) { return v < 10 ? '#3b82f6' : v < 16 ? '#06b6d4' : v <= 28 ? '#10b981' : v <= 32 ? '#f59e0b' : '#ef4444'; }
function phColor(v) { return v < 5.5 ? '#ef4444' : v > 7.2 ? '#f59e0b' : '#10b981'; }
function batteryColor(v) { return v < 15 ? '#ef4444' : v < 30 ? '#f59e0b' : '#10b981'; }
function severityColor(s) { return s === 'critical' ? 'var(--red)' : s === 'warning' ? 'var(--yellow)' : 'var(--blue)'; }
function rand(min, max, dp = 1) { return parseFloat((Math.random() * (max - min) + min).toFixed(dp)); }
function randi(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = randi(0, i);[a[i], a[j]] = [a[j], a[i]]; } return a; }

function appendS01Message(message) {
  const container = document.getElementById('hardware-log-container');
  if (!container) return;

  // Remove placeholder "Waiting for hardware data..." if present
  const placeholder = container.querySelector('div[style*="font-family: var(--font-sans)"]');
  if (placeholder) {
    placeholder.remove();
  }

  const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const logLine = document.createElement('div');
  logLine.style.padding = '4px 6px';
  logLine.style.borderBottom = '1px solid rgba(255, 255, 255, 0.03)';
  logLine.innerHTML = `<span style="color: var(--green); font-weight: 600;">S-01</span> <span style="color: var(--text-muted);">|</span> <span style="color: var(--text-secondary);">${timeStr}</span> <span style="color: var(--text-muted);">|</span> <span style="color: var(--text-primary); font-weight: 500;">${message}</span>`;
  
  container.appendChild(logLine);
  
  // Auto-scroll to latest message
  container.scrollTop = container.scrollHeight;
}

/* ----------------------------------------------------------------
   15. WEBSOCKET CLIENT — BACKEND INTEGRATION
   ---------------------------------------------------------------- */
let wsConnection = null;
let wsConnected = false;
let wsReconnectTimer = null;
const WS_RECONNECT_INTERVAL = 3000;

function getWsUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.hostname || 'localhost';
  const port = location.port || '8000';
  return `${protocol}//${host}:${port}/ws/sensors`;
}

function connectWebSocket() {
  if (wsConnection && wsConnection.readyState <= WebSocket.OPEN) return;

  const url = getWsUrl();
  console.log(`%c📡 Connecting to backend: ${url}`, 'color:#06b6d4');

  try {
    wsConnection = new WebSocket(url);
  } catch (e) {
    console.warn('WebSocket construction failed, running in offline mode.');
    return;
  }

  wsConnection.onopen = () => {
    wsConnected = true;
    clearTimeout(wsReconnectTimer);
    console.log('%c✅ WebSocket connected — receiving live data', 'color:#10b981;font-weight:bold');
    showToast('📡 Connected to SCADA backend — live data active', 'success');

    // Stop local simulation when backend is feeding data
    if (state.updateTimer) {
      clearInterval(state.updateTimer);
      state.updateTimer = null;
    }

    // Update sidebar status
    const statusDot = document.querySelector('.status-dot');
    if (statusDot) statusDot.classList.add('pulse');
  };

  wsConnection.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (!payload.sensors || !Array.isArray(payload.sensors)) return;

      // Map backend sensor states to frontend state.sensors array
      payload.sensors.forEach((backendSensor, i) => {
        if (i >= state.sensors.length) return;
        const s = state.sensors[i];
        const d = backendSensor.data;

        // Core metrics from backend
        s.temperature = d.temperature;
        s.moisture = d.moisture;
        s.pH = d.pH;
        s.battery = d.battery;
        s.humidity = d.humidity;
        s.light = d.light;
        s.nitrogen = d.nitrogen;
        s.phosphorus = d.phosphorus;
        s.potassium = d.potassium;
        s.signalStrength = d.signalStrength;

        // Status from backend
        s.isOnline = (backendSensor.status === 'ONLINE');
        s.isReal = backendSensor.is_real;
        s.lastUpdate = new Date(backendSensor.timestamp);

        // Recompute frontend-only derived values
        s.plantHealth = computePlantHealth(s);
        s.status = determineSensorStatus(s);

        // Append raw message if received for S-01
        if (s.id === 'S-01' && d.raw_message) {
          appendS01Message(d.raw_message);
        }
      });

      // Render everything with fresh data
      renderFieldGrid();
      updateStatistics();
      generateAlerts();
      renderMiniAlerts();
      renderFieldIntelligence();
      updateEnvBar();

      // Update active sub-sections
      const activeSec = document.querySelector('.section.active');
      if (activeSec) {
        const id = activeSec.id;
        if (id === 'section-heatmap') renderHeatmap();
        if (id === 'section-field-grid') renderFullFieldGrid();
        if (id === 'section-alerts') renderFullAlertsList();
        if (id === 'section-charts') updateChartsData();
      }
    } catch (e) {
      console.warn('Failed to parse WebSocket message:', e);
    }
  };

  wsConnection.onclose = () => {
    if (wsConnected) {
      console.log('%c⚠️ WebSocket disconnected — falling back to local simulation', 'color:#f59e0b');
      showToast('⚠️ Backend connection lost — running local simulation', 'warning');
    }
    wsConnected = false;
    wsConnection = null;

    // Resume local simulation as fallback
    if (!state.updateTimer) {
      state.updateTimer = setInterval(runUpdate, UPDATE_INTERVAL_MS);
    }

    // Schedule reconnect attempt
    wsReconnectTimer = setTimeout(connectWebSocket, WS_RECONNECT_INTERVAL);
  };

  wsConnection.onerror = () => {
    // onclose will fire after this, which handles reconnection
  };
}

/* ----------------------------------------------------------------
   16. MAIN LOOP & INIT
   ---------------------------------------------------------------- */
function runUpdate() {
  // Only run local simulation when NOT connected to backend
  if (!wsConnected) {
    tickEnvironment();
    tickSensors();
  }

  renderFieldGrid();
  updateStatistics();
  generateAlerts();
  renderMiniAlerts();
  renderFieldIntelligence();
  updateEnvBar();

  // Update the currently visible subsection
  const activeSec = document.querySelector('.section.active');
  if (activeSec) {
    const id = activeSec.id;
    if (id === 'section-heatmap') renderHeatmap();
    if (id === 'section-field-grid') renderFullFieldGrid();
    if (id === 'section-alerts') renderFullAlertsList();
    if (id === 'section-charts') updateChartsData();
  }
}

function startSimulation() {
  // Initial render with local data
  runUpdate();

  // Start local simulation (will be stopped if WebSocket connects)
  state.updateTimer = setInterval(runUpdate, UPDATE_INTERVAL_MS);

  // Real-time clock
  setInterval(() => {
    const clockEl = document.getElementById('sidebar-time');
    if (clockEl) clockEl.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, 1000);

  // Attempt WebSocket connection to backend
  connectWebSocket();
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('%c🥔 PotatoSense v4.0 — Industrial IoT Digital Twin', 'color:#10b981;font-size:14px;font-weight:bold');
  initSensors();
  startSimulation();
  showToast('🥔 Dashboard initialized — connecting to backend...', 'success');
});

// Toggle Live View action
let isLiveViewRunning = true;

function toggleLiveView(btn) {
  isLiveViewRunning = !isLiveViewRunning;
  if (isLiveViewRunning) {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg> Live View: ON`;
    btn.style.background = 'rgba(16, 185, 129, 0.15)';
    btn.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    btn.style.color = 'var(--green)';
    showToast('📡 Live View resumed. All sensors online.', 'success');

    // Turn all sensors on
    state.sensors.forEach(s => {
      s.isOnline = true;
      s.status = determineSensorStatus(s);
    });

    // Reconnect to backend
    connectWebSocket();

    // Also start local simulation as fallback
    if (!state.updateTimer) {
      state.updateTimer = setInterval(runUpdate, UPDATE_INTERVAL_MS);
    }
    runUpdate();
  } else {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Live View: OFF`;
    btn.style.background = 'rgba(239, 68, 68, 0.15)';
    btn.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    btn.style.color = 'var(--red)';
    showToast('⏸️ Live View paused. All sensors offline.', 'warning');

    // Turn all sensors off
    state.sensors.forEach(s => {
      s.isOnline = false;
      s.status = 'offline';
    });

    // Disconnect WebSocket
    if (wsConnection) {
      clearTimeout(wsReconnectTimer);
      wsConnection.onclose = null; // prevent auto-reconnect
      wsConnection.close();
      wsConnection = null;
      wsConnected = false;
    }

    // Stop local simulation
    clearInterval(state.updateTimer);
    state.updateTimer = null;
    runUpdate();
  }
}

// Toggle Individual Sensor Power
function toggleSensorPower() {
  if (state.currentModalSensorIndex === undefined) return;
  const s = state.sensors[state.currentModalSensorIndex];
  s.isOnline = !s.isOnline;

  if (!s.isOnline) {
    s.status = 'offline';
  } else {
    s.status = determineSensorStatus(s);
  }

  // Re-render the modal to update UI and button
  openSensorModal(state.currentModalSensorIndex);

  // Force update to refresh the grid immediately
  runUpdate();

  showToast(`🔌 Sensor ${s.id} is now ${s.isOnline ? 'ON' : 'OFF'}`, s.isOnline ? 'success' : 'warning');
}
