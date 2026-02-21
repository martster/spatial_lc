import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js";

const canvas = document.getElementById("hydra-canvas");
const codeEditor = document.getElementById("hydra-code");
const runBtn = document.getElementById("run-btn");
const resetBtn = document.getElementById("reset-btn");
const randomBtn = document.getElementById("random-btn");
const arBtn = document.getElementById("ar-btn");
const publishArchiveBtn = document.getElementById("publish-archive-btn");
const statusEl = document.getElementById("status");
const appRoot = document.querySelector(".app");
const toggleSyncBtn = document.getElementById("toggle-sync-btn");
const toggleGalleryBtn = document.getElementById("toggle-gallery-btn");
const syncPanel = document.getElementById("sync-panel");
const galleryPanel = document.getElementById("gallery-panel");
const openShareSessionBtn = document.getElementById("open-share-session-btn");
const shareSessionDetails = document.getElementById("share-session-details");

const roleChip = document.getElementById("role-chip");
const roomIdInput = document.getElementById("room-id");
const hostBtn = document.getElementById("host-btn");
const joinBtn = document.getElementById("join-btn");
const copyLinkBtn = document.getElementById("copy-link-btn");
const qrLinkBtn = document.getElementById("qr-link-btn");
const syncStatusEl = document.getElementById("sync-status");

const overlayRoot = document.getElementById("ar-overlay");
const overlayExitBtn = document.getElementById("overlay-exit-btn");
const overlayRestageLatestBtn = document.getElementById("overlay-restage-latest-btn");
const overlayReplayStartBtn = document.getElementById("overlay-replay-start-btn");
const overlayReplayNextBtn = document.getElementById("overlay-replay-next-btn");
const overlayReplayStopBtn = document.getElementById("overlay-replay-stop-btn");
const overlayUndoBtn = document.getElementById("overlay-undo-btn");
const overlayClearBtn = document.getElementById("overlay-clear-btn");
let overlayStatusEl = document.getElementById("overlay-status");

const galleryGrid = document.getElementById("gallery-grid");
const clearGalleryBtn = document.getElementById("clear-gallery-btn");
const renderFilmBtn = document.getElementById("render-film-btn");
const filmStatusEl = document.getElementById("film-status");
const filmDownloadLink = document.getElementById("film-download-link");
const windowAllBtn = document.getElementById("archive-window-all");
const windowWeekBtn = document.getElementById("archive-window-week");
const windowTodayBtn = document.getElementById("archive-window-today");
const archiveViewerRoot = document.getElementById("archive-viewer");
const archiveCanvas = document.getElementById("archive-canvas");
const archiveControlsToggleBtn = document.getElementById("archive-controls-toggle-btn");
const archiveControlsPanel = document.getElementById("archive-controls-panel");
const archivePrevBtn = document.getElementById("archive-prev-btn");
const archiveNextBtn = document.getElementById("archive-next-btn");
const archiveAutoplayBtn = document.getElementById("archive-autoplay-btn");
const archiveStatusEl = document.getElementById("archive-status");
const qrDialog = document.getElementById("qr-dialog");
const qrCodeEl = document.getElementById("qr-code");
const qrUrlEl = document.getElementById("qr-url");
const qrCloseBtn = document.getElementById("qr-close-btn");

const QUICK_LOOK_USDZ =
  "https://modelviewer.dev/shared-assets/models/Astronaut.usdz";
const GALLERY_KEY = "spatial_lc_gallery_v3";

let hydra;
let webcam;
let arMode = "unsupported";
let vrMode = "unsupported";

let xrRenderer;
let xrScene;
let xrCamera;
let xrController;
let xrReticle;
let xrWallReticle;
let xrHydraGeometry;
let xrFloorHitTestSource = null;
const xrWallHitTestSources = [];
let xrRefSpace = null;
let xrPlaneDetectionEnabled = false;
let xrPlaneDetectionSeen = false;
let lastPlaneHintTs = 0;
let lastWallDebugTs = 0;

let desktopRenderer;
let desktopScene;
let desktopCamera;
let desktopHydraGeometry;
let desktopActive = false;
let desktopRaf = 0;
let desktopHasSeedPanel = false;

let vrRenderer;
let vrScene;
let vrCamera;
let vrController;
let vrArchivePanels = [];
let vrFocusIndex = 0;

let archiveRenderer;
let archiveScene;
let archiveCamera;
let archivePanels = [];
let archiveFocusIndex = 0;
let archiveAutoplayTimer = 0;
let archiveRaf = 0;
let archiveFilmRendering = false;
let archiveFilmUrl = "";

let peer;
let roomId = "";
let actingAsHost = false;
let hostConn = null;
const viewerConnections = new Set();

const placedPanels = [];
let galleryItems = [];
let archiveWindowFilter = "all";
let gallerySnippets = [];
let gallerySnippetsLoaded = false;
let lastGoodFrameCanvas = null;
let currentExitAction = null;
let currentSketchId = null;
let currentReticleSurface = null;
let clearArConfirmUntil = 0;
let lastLockedWallSurface = null;
let lastLockedWallTs = 0;
let lastAutoSurfaceKind = null;
let lastAutoSurfaceTs = 0;
let archiveReplayTimer = 0;
let archiveReplayActive = false;
let archiveReplayIndex = 0;
const panelRunnerMount = document.createElement("div");
panelRunnerMount.style.position = "fixed";
panelRunnerMount.style.left = "-10000px";
panelRunnerMount.style.top = "-10000px";
panelRunnerMount.style.width = "1px";
panelRunnerMount.style.height = "1px";
panelRunnerMount.style.overflow = "hidden";
document.body.appendChild(panelRunnerMount);
const isLikelyMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
const PANEL_RUNNER_WIDTH = isLikelyMobile ? 256 : 384;
const PANEL_RUNNER_HEIGHT = isLikelyMobile ? 144 : 216;
const MAX_PLACED_PANELS = isLikelyMobile ? 10 : 18;
const MAX_ACTIVE_RUNNERS = 1;
const WALL_LOCK_KEEP_MS = 14000;
const AUTO_SURFACE_STICKY_MS = 900;
const PANEL_WIDTH_METERS = 0.84;
const PANEL_HEIGHT_METERS = PANEL_WIDTH_METERS * (9 / 16);
const FLOOR_PANEL_OFFSET_M = 0.006;
const WALL_PANEL_OFFSET_M = 0.00035;
const ESTIMATED_WALL_OFFSET_M = 0.001;
const TRACKING_HINT_COOLDOWN_MS = 3200;
const REPLAY_INTERVAL_MS = 6000;

const urlParams = new URLSearchParams(window.location.search);
let role = resolveRole();

const defaultCode = `
solid(0.02, 0.01, 0.04)
  .layer(
    osc(8, 0.03, 1.4)
      .kaleid(7)
      .rotate(() => time * 0.05)
      .color(1, 0.2, 0.7)
      .luma(0.2)
  )
  .layer(
    noise(2.8, 0.07)
      .color(0.1, 1.0, 0.9)
      .luma(0.45)
      .blend(solid(), 0.55)
  )
  .modulate(osc(12, 0.02, 0.4), 0.08)
  .out(o0)

render(o0)
`.trim();

const hydraSnippets = [
  `
osc(8, 0.02, 1.1)
  .kaleid(7)
  .rotate(() => time * 0.05)
  .color(1, 0.2, 0.7)
  .modulate(noise(2.5, 0.08), 0.14)
  .out(o0)
render(o0)
`.trim(),
  `
voronoi(4, 0.3, 0.4)
  .color(0.1, 1, 0.85)
  .posterize(6, 0.25)
  .scrollY(() => Math.sin(time * 0.2) * 0.03)
  .out(o0)
render(o0)
`.trim(),
  `
shape(4, 0.45, 0.02)
  .repeat(3, 2)
  .rotate(() => time * 0.12)
  .color(1, 0.9, 0.1)
  .mult(osc(30, 0.01, 0.7))
  .out(o0)
render(o0)
`.trim(),
  `
noise(3, 0.12)
  .colorama(() => 0.02 + Math.sin(time * 0.7) * 0.02)
  .modulate(osc(12, 0.03, 0.6), 0.1)
  .out(o0)
render(o0)
`.trim()
];

function resolveRole() {
  const explicit = urlParams.get("role");
  if (explicit === "viewer" || explicit === "controller" || explicit === "archive") {
    return explicit;
  }

  const looksLikePhone =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "") ||
    (navigator.maxTouchPoints > 0 && window.matchMedia("(max-width: 860px)").matches);

  if (looksLikePhone && urlParams.get("room")) {
    return "viewer";
  }

  return "controller";
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
  const badge = ensureOverlayStatusEl();
  badge.textContent = message;
  badge.classList.toggle("error", isError);
  badge.style.color = isError ? "#ff5d7c" : "#ffe9ff";
}

function ensureOverlayStatusEl() {
  if (overlayStatusEl) {
    return overlayStatusEl;
  }
  overlayStatusEl = document.createElement("p");
  overlayStatusEl.id = "overlay-status";
  overlayStatusEl.className = "ar-overlay-status";
  overlayStatusEl.setAttribute("aria-live", "polite");
  overlayStatusEl.style.flex = "1 1 100%";
  overlayStatusEl.style.margin = "0";
  overlayStatusEl.style.padding = "0.45rem 0.6rem";
  overlayStatusEl.style.border = "1px solid #ff46c7";
  overlayStatusEl.style.borderRadius = "0.2rem";
  overlayStatusEl.style.background = "rgba(7, 4, 23, 0.9)";
  overlayStatusEl.style.color = "#ffe9ff";
  overlayStatusEl.style.fontSize = "0.86rem";
  overlayStatusEl.style.lineHeight = "1.35";
  overlayStatusEl.style.fontWeight = "700";
  overlayStatusEl.style.textShadow = "0 0 4px rgba(0,0,0,0.6)";
  overlayRoot.appendChild(overlayStatusEl);
  return overlayStatusEl;
}

function setSyncStatus(message, isError = false) {
  syncStatusEl.textContent = message;
  syncStatusEl.classList.toggle("error", isError);
}

function setAppVisible(visible) {
  appRoot.style.display = visible ? "" : "none";
}

function setPanelVisibility(panelEl, toggleBtn, visible) {
  if (!panelEl || !toggleBtn) {
    return;
  }
  panelEl.hidden = !visible;
  toggleBtn.setAttribute("aria-expanded", String(visible));
  toggleBtn.classList.toggle("active", visible);
}

function toggleSyncPanel() {
  if (!syncPanel || !toggleSyncBtn) {
    return;
  }
  setPanelVisibility(syncPanel, toggleSyncBtn, syncPanel.hidden);
}

async function triggerShareFromDock() {
  setPanelVisibility(syncPanel, toggleSyncBtn, true);
  if (shareSessionDetails?.hidden) {
    toggleShareSessionDetails();
  }
  await shareViewerLink();
}

function toggleGalleryPanel() {
  if (!galleryPanel || !toggleGalleryBtn) {
    return;
  }
  setPanelVisibility(galleryPanel, toggleGalleryBtn, galleryPanel.hidden);
}

function toggleShareSessionDetails() {
  if (!shareSessionDetails || !openShareSessionBtn) {
    return;
  }
  const nextVisible = shareSessionDetails.hidden;
  shareSessionDetails.hidden = !nextVisible;
  openShareSessionBtn.textContent = nextVisible ? "Hide Session Details" : "Share AR Session";
  openShareSessionBtn.setAttribute("aria-expanded", String(nextVisible));
}

function setImmersiveUiMode(mode) {
  document.body.classList.toggle("ar-session", mode === "ar");
  document.body.classList.toggle("vr-session", mode === "vr");
}

function showArOverlay(exitLabel, onExit, mode = "ar") {
  overlayRoot.hidden = false;
  overlayRoot.style.pointerEvents = "auto";
  overlayRoot.addEventListener("beforexrselect", preventXrSelect);
  currentExitAction = onExit;
  overlayExitBtn.textContent = exitLabel;
  overlayClearBtn.textContent = "Clear All";
  clearArConfirmUntil = 0;
  const badge = ensureOverlayStatusEl();
  badge.textContent = mode === "vr" ? "VR archive active." : "AR overlay active. Scanning...";
  badge.classList.remove("error");
  setImmersiveUiMode(mode);
}

function hideArOverlay() {
  overlayRoot.hidden = true;
  overlayRoot.removeEventListener("beforexrselect", preventXrSelect);
  currentExitAction = null;
  overlayClearBtn.textContent = "Clear All";
  clearArConfirmUntil = 0;
  setImmersiveUiMode(null);
}

function preventXrSelect(event) {
  event.preventDefault();
}

function randomRoomId() {
  return `spatial-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneCanvas(srcCanvas) {
  const out = document.createElement("canvas");
  out.width = srcCanvas.width;
  out.height = srcCanvas.height;
  const ctx = out.getContext("2d");
  ctx.drawImage(srcCanvas, 0, 0, out.width, out.height);
  return out;
}

function estimateLuma(canvasEl) {
  const ctx = canvasEl.getContext("2d");
  if (!ctx) {
    return 0;
  }

  const sampleW = Math.min(48, canvasEl.width || 48);
  const sampleH = Math.min(27, canvasEl.height || 27);
  const img = ctx.getImageData(0, 0, sampleW, sampleH).data;
  let sum = 0;
  const pxCount = sampleW * sampleH;
  for (let i = 0; i < img.length; i += 4) {
    sum += (img[i] + img[i + 1] + img[i + 2]) / 3;
  }
  return pxCount > 0 ? sum / pxCount : 0;
}

function captureHydraFrame() {
  const snap = document.createElement("canvas");
  const width =
    canvas.width || Math.max(2, Math.floor(canvas.clientWidth * window.devicePixelRatio));
  const height =
    canvas.height || Math.max(2, Math.floor(canvas.clientHeight * window.devicePixelRatio));
  snap.width = width;
  snap.height = height;
  const ctx = snap.getContext("2d");
  ctx.drawImage(canvas, 0, 0, width, height);

  const luma = estimateLuma(snap);
  if (luma > 4) {
    lastGoodFrameCanvas = cloneCanvas(snap);
    return snap;
  }

  if (lastGoodFrameCanvas) {
    return cloneCanvas(lastGoodFrameCanvas);
  }

  return snap;
}

async function ensureGallerySnippetsLoaded() {
  if (gallerySnippetsLoaded) {
    return;
  }

  gallerySnippetsLoaded = true;
  const localUrl = "./hydra-gallery-snippets.json";

  try {
    const res = await fetch(localUrl, { cache: "no-store" });
    if (!res.ok) {
      throw new Error("gallery fetch failed");
    }
    const data = await res.json();
    gallerySnippets = Array.isArray(data)
      ? data.filter((item) => typeof item?.code === "string" && item.code.length > 10)
      : [];
    if (gallerySnippets.length === 0) {
      throw new Error("no compatible snippets");
    }
    setSyncStatus(`Hydra gallery ready (${gallerySnippets.length} local snippets).`);
  } catch {
    gallerySnippets = [];
    setSyncStatus("Hydra gallery file unavailable.", true);
  }
}

function updateRoleUI() {
  if (role === "controller") {
    roleChip.textContent = "Mode: Studio (Laptop hosts session)";
  } else if (role === "archive") {
    roleChip.textContent = "Mode: Archive Viewer";
  } else {
    roleChip.textContent = "Mode: AR Viewer (Phone)";
  }

  if (role === "viewer" || role === "archive") {
    document.body.classList.add("viewer-role");
    codeEditor.readOnly = true;
  } else {
    document.body.classList.remove("viewer-role");
    codeEditor.readOnly = false;
  }

  document.body.classList.toggle("archive-role", role === "archive");
  if (archiveViewerRoot) {
    archiveViewerRoot.hidden = role !== "archive";
  }
  if (role !== "archive") {
    setArchiveAutoplay(false);
    if (archiveControlsPanel) {
      archiveControlsPanel.hidden = true;
    }
    if (archiveControlsToggleBtn) {
      archiveControlsToggleBtn.hidden = true;
      archiveControlsToggleBtn.setAttribute("aria-expanded", "false");
      archiveControlsToggleBtn.textContent = "Playback";
    }
  }
}

async function applyStartupSnippet() {
  await ensureGallerySnippetsLoaded();
  if (gallerySnippets.length > 0) {
    const next = gallerySnippets[Math.floor(Math.random() * gallerySnippets.length)];
    codeEditor.value = next.code;
    applyHydraCode(next.code);
    currentSketchId = next.sketch_id || null;
    return true;
  }

  codeEditor.value = defaultCode;
  applyHydraCode(codeEditor.value);
  currentSketchId = null;
  return false;
}

function updateUrlState(nextRole, nextRoom) {
  const params = new URLSearchParams(window.location.search);
  params.set("role", nextRole);
  if (nextRoom) {
    params.set("room", nextRoom);
  } else {
    params.delete("room");
  }
  history.replaceState({}, "", `${location.pathname}?${params.toString()}`);
}

function broadcastToViewers(payload, excludeConn = null) {
  for (const conn of viewerConnections) {
    if (conn !== excludeConn && conn.open) {
      conn.send(payload);
    }
  }
}

function sendToHost(payload) {
  if (hostConn?.open) {
    hostConn.send(payload);
  }
}

function applyHydraCode(code, fromRemote = false) {
  codeEditor.value = code;
  try {
    new Function(codeEditor.value)();
    if (!fromRemote) {
      setStatus("Script running.");
    }
  } catch (error) {
    setStatus(`Error: ${error.message}`, true);
  }
}

async function applyRandomSnippet() {
  await ensureGallerySnippetsLoaded();
  if (gallerySnippets.length === 0) {
    setStatus("Random failed: Hydra gallery could not be loaded.", true);
    return;
  }

  const next = gallerySnippets[Math.floor(Math.random() * gallerySnippets.length)];
  codeEditor.value = next.code;
  applyHydraCode(next.code);
  currentSketchId = next.sketch_id || null;
  setStatus(`Random loaded from Hydra sketch ${next.sketch_id}.`);
  if (actingAsHost) {
    broadcastToViewers({ type: "code", code: next.code });
  }
}

function normalizeSpatial(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (!Array.isArray(value.position) || !Array.isArray(value.quaternion)) {
    return null;
  }
  if (value.position.length !== 3 || value.quaternion.length !== 4) {
    return null;
  }
  return {
    kind: value.kind || "unknown",
    source: value.source || "archive",
    position: value.position.map((n) => Number(n) || 0),
    quaternion: value.quaternion.map((n) => Number(n) || 0),
    normal: Array.isArray(value.normal) && value.normal.length === 3
      ? value.normal.map((n) => Number(n) || 0)
      : null
  };
}

function serializePlacement(placement) {
  if (!placement?.position || !placement?.quaternion) {
    return null;
  }
  return {
    kind: placement.kind || "unknown",
    source: placement.source || "tracked",
    position: [placement.position.x, placement.position.y, placement.position.z],
    quaternion: [
      placement.quaternion.x,
      placement.quaternion.y,
      placement.quaternion.z,
      placement.quaternion.w
    ],
    normal: placement.normal
      ? [placement.normal.x, placement.normal.y, placement.normal.z]
      : null
  };
}

function deserializePlacement(spatial) {
  const clean = normalizeSpatial(spatial);
  if (!clean) {
    return null;
  }
  return {
    kind: clean.kind,
    source: clean.source,
    position: new THREE.Vector3(clean.position[0], clean.position[1], clean.position[2]),
    quaternion: new THREE.Quaternion(
      clean.quaternion[0],
      clean.quaternion[1],
      clean.quaternion[2],
      clean.quaternion[3]
    ),
    normal: clean.normal
      ? new THREE.Vector3(clean.normal[0], clean.normal[1], clean.normal[2])
      : new THREE.Vector3(0, 1, 0)
  };
}

function normalizeGalleryItem(entry) {
  return {
    ...entry,
    spatial: normalizeSpatial(entry?.spatial)
  };
}

function isItemInWindow(item, windowFilter) {
  if (windowFilter === "all") {
    return true;
  }
  const now = Date.now();
  const ts = Number(item.ts) || 0;
  if (windowFilter === "today") {
    return now - ts <= 24 * 60 * 60 * 1000;
  }
  if (windowFilter === "week") {
    return now - ts <= 7 * 24 * 60 * 60 * 1000;
  }
  return true;
}

function getFilteredGalleryItems() {
  return galleryItems.filter((item) => isItemInWindow(item, archiveWindowFilter));
}

function updateArchiveFilterUi() {
  windowAllBtn.classList.toggle("active", archiveWindowFilter === "all");
  windowWeekBtn.classList.toggle("active", archiveWindowFilter === "week");
  windowTodayBtn.classList.toggle("active", archiveWindowFilter === "today");
}

function getReplaySequenceItems() {
  return getFilteredGalleryItems()
    .slice()
    .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
}

function updateReplayUi() {
  if (overlayReplayStartBtn) {
    overlayReplayStartBtn.disabled = archiveReplayActive;
  }
  if (overlayReplayStopBtn) {
    overlayReplayStopBtn.disabled = !archiveReplayActive;
  }
}

function cloneSurfacePlacement(surface) {
  if (!surface?.position || !surface?.quaternion) {
    return null;
  }
  return {
    kind: surface.kind || "wall",
    source: surface.source || "replay",
    position: surface.position.clone(),
    quaternion: surface.quaternion.clone(),
    normal: surface.normal?.clone?.() || new THREE.Vector3(0, 1, 0)
  };
}

function buildReplayPlacement(item) {
  if (!xrRenderer || !xrScene || !xrHydraGeometry) {
    return null;
  }

  const xrCam = xrRenderer.xr.getCamera(xrCamera);
  const cameraPos = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld);
  const cameraForward = new THREE.Vector3();
  xrCam.getWorldDirection(cameraForward);
  if (cameraForward.lengthSq() < 0.01) {
    cameraForward.set(0, 0, -1);
  }
  cameraForward.normalize();

  if (currentReticleSurface) {
    return cloneSurfacePlacement(currentReticleSurface);
  }

  const archived = deserializePlacement(item?.spatial);
  if (archived?.position && archived?.quaternion) {
    const toArchived = archived.position.clone().sub(cameraPos);
    const distance = toArchived.length();
    if (distance > 0.2 && distance < 3.5 && toArchived.normalize().dot(cameraForward) > 0.2) {
      archived.source = "archive";
      return archived;
    }
  }

  return buildEstimatedWallSurface(cameraPos, cameraForward, 1.1);
}

function applyArchiveMoment(item, placeInAr = true) {
  if (!item) {
    return false;
  }

  if (typeof item.code === "string" && item.code.trim()) {
    applyHydraCode(item.code);
  }

  if (placeInAr) {
    const activeXr = xrRenderer?.xr.getSession();
    if (!activeXr || !xrScene || !xrHydraGeometry) {
      setStatus("Start AR first to run cinematic replay.", true);
      return false;
    }
    const placement = buildReplayPlacement(item);
    if (!placement) {
      setStatus("Replay could not determine a placement target yet. Move slowly and scan walls.", true);
      return false;
    }
    addPanelAt(xrScene, xrHydraGeometry, placement);
  }

  return true;
}

function stepArchiveReplay(placeInAr = true) {
  const sequence = getReplaySequenceItems();
  if (sequence.length === 0) {
    setStatus("Replay needs at least one archived moment.", true);
    return;
  }
  const item = sequence[archiveReplayIndex % sequence.length];
  const didApply = applyArchiveMoment(item, placeInAr);
  if (!didApply) {
    if (archiveReplayActive) {
      stopArchiveReplay(false);
    }
    return;
  }
  archiveReplayIndex += 1;
  setStatus(
    `Replay moment ${Math.min(archiveReplayIndex, sequence.length)}/${sequence.length}: ${new Date(item.ts).toLocaleString()}`
  );
}

function stopArchiveReplay(announce = true) {
  if (archiveReplayTimer) {
    window.clearInterval(archiveReplayTimer);
    archiveReplayTimer = 0;
  }
  archiveReplayActive = false;
  updateReplayUi();
  if (announce) {
    setStatus("Cinematic replay stopped.");
  }
}

function startArchiveReplay() {
  const sequence = getReplaySequenceItems();
  if (sequence.length === 0) {
    setStatus("Replay needs at least one archived moment.", true);
    return;
  }
  stopArchiveReplay(false);
  archiveReplayActive = true;
  archiveReplayIndex = 0;
  updateReplayUi();
  setStatus("Replay started. Moments are placed at the current AR target/in front of you.");
  const intervalMs = REPLAY_INTERVAL_MS;
  stepArchiveReplay(true);
  archiveReplayTimer = window.setInterval(() => {
    stepArchiveReplay(true);
  }, intervalMs);
}

function addGalleryItem(
  snapshot,
  code,
  mode,
  id = null,
  ts = Date.now(),
  sketchId = currentSketchId,
  spatial = null
) {
  const itemId = id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (galleryItems.some((entry) => entry.id === itemId)) {
    return itemId;
  }

  galleryItems.unshift({
    id: itemId,
    snapshot,
    code,
    sketch_id: sketchId || null,
    mode,
    ts,
    spatial: normalizeSpatial(spatial)
  });

  saveGallery();
  renderGallery();
  return itemId;
}

function handleData(data, sourceConn = null) {
  if (!data || typeof data !== "object") {
    return;
  }

  if (data.type === "request-sync" && actingAsHost) {
    sourceConn?.send({ type: "code", code: codeEditor.value });
    sourceConn?.send({ type: "gallery-sync", items: galleryItems.slice(0, 120) });
    return;
  }

  if (data.type === "code" && typeof data.code === "string") {
    if (role !== "archive") {
      applyHydraCode(data.code, true);
    }
    if (role === "viewer") {
      setStatus("Remote code received.");
    }
    return;
  }

  if (data.type === "gallery-item" && data.item) {
    const item = data.item;
    addGalleryItem(
      item.snapshot,
      item.code,
      item.mode,
      item.id,
      item.ts,
      item.sketch_id,
      item.spatial
    );

    if (actingAsHost) {
      broadcastToViewers({ type: "gallery-item", item }, sourceConn);
    }
    return;
  }

  if (data.type === "gallery-sync" && Array.isArray(data.items)) {
    galleryItems = data.items.map((entry) => normalizeGalleryItem(entry));
    saveGallery();
    renderGallery();
  }
}

function closePeerState() {
  if (hostConn) {
    hostConn.close();
    hostConn = null;
  }

  for (const conn of viewerConnections) {
    conn.close();
  }
  viewerConnections.clear();

  if (peer) {
    peer.destroy();
    peer = null;
  }

  actingAsHost = false;
}

function ensurePeerJsAvailable() {
  if (!window.Peer) {
    throw new Error("PeerJS is unavailable in this browser.");
  }
}

function attachViewerConnection(conn) {
  viewerConnections.add(conn);
  setSyncStatus(`Viewer connected (${viewerConnections.size}).`);

  conn.on("data", (data) => handleData(data, conn));
  conn.on("close", () => {
    viewerConnections.delete(conn);
    setSyncStatus(`Viewer disconnected (${viewerConnections.size}).`);
  });
  conn.on("error", (error) => {
    setSyncStatus(`Viewer connection error: ${error.message}`, true);
  });
}

function hostSession() {
  ensurePeerJsAvailable();
  const desiredRoom = (roomIdInput.value || "").trim() || randomRoomId();

  closePeerState();
  roomId = desiredRoom;
  roomIdInput.value = roomId;
  actingAsHost = true;

  peer = new window.Peer(roomId);

  peer.on("open", () => {
    updateUrlState("controller", roomId);
    setSyncStatus(`Host session live: ${roomId}`);
  });

  peer.on("connection", (conn) => {
    attachViewerConnection(conn);
  });

  peer.on("error", (error) => {
    setSyncStatus(`Host error: ${error.message}`, true);
  });
}

function joinSession() {
  ensurePeerJsAvailable();
  const targetRoom = (roomIdInput.value || "").trim();
  if (!targetRoom) {
    setSyncStatus("Enter a room id first.", true);
    return;
  }

  closePeerState();
  roomId = targetRoom;
  actingAsHost = false;

  peer = new window.Peer();
  peer.on("open", () => {
    hostConn = peer.connect(roomId, { reliable: true });

    hostConn.on("open", () => {
      updateUrlState(role === "archive" ? "archive" : "viewer", roomId);
      setSyncStatus(`${role === "archive" ? "Archive viewer" : "Viewer"} connected to: ${roomId}`);
      hostConn.send({ type: "request-sync" });
    });

    hostConn.on("data", (data) => handleData(data));
    hostConn.on("close", () => {
      setSyncStatus("Disconnected from host.", true);
      hostConn = null;
    });
    hostConn.on("error", (error) => {
      setSyncStatus(`Join error: ${error.message}`, true);
    });
  });

  peer.on("error", (error) => {
    setSyncStatus(`Peer error: ${error.message}`, true);
  });
}

function buildViewerUrl() {
  const room =
    (roomIdInput.value || "").trim() ||
    new URLSearchParams(window.location.search).get("room") ||
    "";
  const url = new URL(window.location.href);
  url.searchParams.set("role", "viewer");
  url.searchParams.set("room", room);
  return { room, url: url.toString() };
}

function buildArchiveUrl() {
  const room =
    (roomIdInput.value || "").trim() ||
    new URLSearchParams(window.location.search).get("room") ||
    "";
  const url = new URL(window.location.href);
  url.searchParams.set("role", "viewer");
  url.searchParams.set("room", room);
  return { room, url: url.toString() };
}

async function shareViewerLink() {
  const { room, url } = buildViewerUrl();
  if (!room) {
    setSyncStatus("Start host session first.", true);
    return;
  }

  try {
    if (navigator.share) {
      await navigator.share({
        title: "Spatial Live Coding AR Viewer",
        text: "Open this on your phone and tap Join as Viewer.",
        url
      });
      setSyncStatus("Viewer link shared.");
      return;
    }

    await navigator.clipboard.writeText(url);
    setSyncStatus("Viewer link copied. Send it to your phone via chat/mail.");
  } catch {
    setSyncStatus(`Viewer link: ${url}`);
  }
}

function showViewerQr() {
  const { room, url } = buildViewerUrl();
  if (!room) {
    setSyncStatus("Start host session first.", true);
    return;
  }
  if (!qrDialog || !qrCodeEl || !qrUrlEl) {
    setSyncStatus(`Viewer link: ${url}`);
    return;
  }

  qrCodeEl.innerHTML = "";
  if (window.QRCode) {
    new window.QRCode(qrCodeEl, {
      text: url,
      width: 220,
      height: 220
    });
  } else {
    qrCodeEl.textContent = "QR library unavailable.";
  }

  qrUrlEl.textContent = url;
  qrDialog.showModal();
}

async function publishArchiveLink() {
  const { room, url } = buildArchiveUrl();
  if (!room) {
    setSyncStatus("Start host session first.", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    setSyncStatus("Archive link copied.");
  } catch {
    setSyncStatus(`Archive link: ${url}`);
  }
}

function loadGallery() {
  try {
    const raw = localStorage.getItem(GALLERY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((entry) => normalizeGalleryItem(entry)) : [];
  } catch {
    return [];
  }
}

function saveGallery() {
  localStorage.setItem(GALLERY_KEY, JSON.stringify(galleryItems.slice(0, 120)));
}

function setArchiveStatus(message, isError = false) {
  if (!archiveStatusEl) {
    return;
  }
  archiveStatusEl.textContent = message;
  archiveStatusEl.classList.toggle("error", isError);
}

function setFilmStatus(message, isError = false) {
  if (!filmStatusEl) {
    return;
  }
  filmStatusEl.textContent = message;
  filmStatusEl.classList.toggle("error", isError);
}

function updateFilmDownload(url, filename = "argolis-archive-film.webm") {
  if (!filmDownloadLink) {
    return;
  }
  if (archiveFilmUrl) {
    URL.revokeObjectURL(archiveFilmUrl);
    archiveFilmUrl = "";
  }
  if (!url) {
    filmDownloadLink.hidden = true;
    filmDownloadLink.removeAttribute("href");
    return;
  }
  archiveFilmUrl = url;
  filmDownloadLink.href = url;
  filmDownloadLink.download = filename;
  filmDownloadLink.hidden = false;
}

function renderArchiveFrame() {
  if (!archiveRenderer || !archiveScene || !archiveCamera) {
    return;
  }
  archiveRenderer.render(archiveScene, archiveCamera);
}

function setArchiveControlState() {
  const hasAny = archivePanels.length > 0;
  const hasMultiple = archivePanels.length > 1;
  if (archiveControlsToggleBtn) {
    archiveControlsToggleBtn.hidden = !hasAny;
  }
  if (!hasAny && archiveControlsPanel) {
    archiveControlsPanel.hidden = true;
  }
  if (archivePrevBtn) {
    archivePrevBtn.disabled = !hasAny;
  }
  if (archiveNextBtn) {
    archiveNextBtn.disabled = !hasAny;
  }
  if (archiveAutoplayBtn) {
    archiveAutoplayBtn.disabled = !hasMultiple;
    if (!hasMultiple) {
      archiveAutoplayBtn.textContent = "Autoplay";
    }
  }
}

function toggleArchiveControls() {
  if (!archiveControlsPanel || !archiveControlsToggleBtn) {
    return;
  }
  const show = archiveControlsPanel.hidden;
  archiveControlsPanel.hidden = !show;
  archiveControlsToggleBtn.setAttribute("aria-expanded", String(show));
  archiveControlsToggleBtn.textContent = show ? "Hide Playback" : "Playback";
}

function initArchiveViewerScene() {
  if (!archiveCanvas || archiveRenderer) {
    return;
  }

  archiveRenderer = new THREE.WebGLRenderer({
    canvas: archiveCanvas,
    antialias: true,
    alpha: true
  });
  archiveRenderer.setPixelRatio(window.devicePixelRatio);
  archiveRenderer.setSize(archiveCanvas.clientWidth, archiveCanvas.clientHeight, false);

  archiveScene = new THREE.Scene();
  archiveScene.background = new THREE.Color(0xf7f7f6);
  archiveCamera = new THREE.PerspectiveCamera(
    58,
    archiveCanvas.clientWidth / Math.max(1, archiveCanvas.clientHeight),
    0.01,
    40
  );
  archiveCamera.position.set(0, 1.55, 2.3);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xd8dde6, 1.1);
  const key = new THREE.DirectionalLight(0xffffff, 0.65);
  key.position.set(2.3, 3.5, 1.4);
  archiveScene.add(hemi, key);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(8, 64),
    new THREE.MeshStandardMaterial({ color: 0xefefed, roughness: 0.98, metalness: 0.01 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  archiveScene.add(floor);

  const render = () => {
    if (!archiveRenderer || role !== "archive") {
      return;
    }
    archiveRenderer.render(archiveScene, archiveCamera);
    archiveRaf = requestAnimationFrame(render);
  };
  render();
}

function clearArchiveViewerPanels() {
  for (const entry of archivePanels) {
    archiveScene?.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    entry.material.map?.dispose?.();
    entry.material.dispose();
  }
  archivePanels = [];
  archiveFocusIndex = 0;
  setArchiveControlState();
}

function focusArchivePanel(nextIndex = archiveFocusIndex) {
  if (!archivePanels.length) {
    setArchiveStatus("No archived moments yet.", true);
    return;
  }
  archiveFocusIndex = (nextIndex + archivePanels.length) % archivePanels.length;
  archivePanels.forEach((entry, idx) => {
    const offset = idx - archiveFocusIndex;
    entry.mesh.position.set(offset * 1.08, 1.55, -2.25 - Math.abs(offset) * 0.45);
    entry.mesh.rotation.y = -offset * 0.17;
    const scale = idx === archiveFocusIndex ? 1.0 : 0.9;
    entry.mesh.scale.setScalar(scale);
  });

  const active = archivePanels[archiveFocusIndex];
  setArchiveStatus(
    `Moment ${archiveFocusIndex + 1}/${archivePanels.length} · ${new Date(active.item.ts).toLocaleString()}`
  );
}

function rebuildArchiveViewer(force = false) {
  if (!force && role !== "archive") {
    return;
  }
  initArchiveViewerScene();
  if (!archiveScene) {
    return;
  }

  const items = getFilteredGalleryItems()
    .slice()
    .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0))
    .slice(-30);

  clearArchiveViewerPanels();

  for (const item of items) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_WIDTH_METERS, PANEL_HEIGHT_METERS),
      material
    );

    if (typeof item.snapshot === "string" && item.snapshot.startsWith("data:image")) {
      new THREE.TextureLoader().load(item.snapshot, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        material.map = texture;
        material.needsUpdate = true;
      });
    }

    archivePanels.push({ mesh, material, item });
    archiveScene.add(mesh);
  }

  if (archivePanels.length === 0) {
    setArchiveControlState();
    setArchiveStatus("Waiting for archive moments from host...", true);
    if (!archiveFilmRendering) {
      setFilmStatus("No panels available for film export.", true);
    }
    return;
  }
  setArchiveControlState();
  focusArchivePanel(archivePanels.length - 1);
  if (!archiveFilmRendering) {
    setFilmStatus("");
  }
}

function setArchiveAutoplay(active) {
  if (archiveAutoplayTimer) {
    window.clearInterval(archiveAutoplayTimer);
    archiveAutoplayTimer = 0;
  }
  if (archiveAutoplayBtn) {
    archiveAutoplayBtn.textContent = active ? "Stop" : "Autoplay";
  }
  if (!active) {
    setArchiveStatus("Playback stopped.");
    return;
  }
  if (archivePanels.length < 2) {
    setArchiveStatus("Autoplay needs at least two moments.", true);
    if (archiveAutoplayBtn) {
      archiveAutoplayBtn.textContent = "Autoplay";
    }
    return;
  }
  setArchiveStatus("Autoplay running.");
  archiveAutoplayTimer = window.setInterval(() => {
    focusArchivePanel(archiveFocusIndex + 1);
  }, 4200);
}

function pickRecordingMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4"
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported?.(type)) {
      return type;
    }
  }
  return "";
}

function waitMs(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function loadTextureFromUrl(loader, url) {
  return new Promise((resolve) => {
    loader.load(
      url,
      (texture) => resolve(texture),
      undefined,
      () => resolve(null)
    );
  });
}

async function renderArchiveFilm() {
  if (archiveFilmRendering) {
    return;
  }
  if (!window.MediaRecorder) {
    setFilmStatus("Film export is not supported in this browser.", true);
    return;
  }

  archiveFilmRendering = true;
  renderFilmBtn.disabled = true;
  setArchiveAutoplay(false);
  stopArchiveReplay(false);
  setFilmStatus("Preparing film export...");
  updateFilmDownload(null);

  try {
    const sequence = getFilteredGalleryItems()
      .slice()
      .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
    if (sequence.length === 0) {
      setFilmStatus("Place at least one panel before rendering a film.", true);
      return;
    }

    const width = 1280;
    const height = 720;
    const filmCanvas = document.createElement("canvas");
    filmCanvas.width = width;
    filmCanvas.height = height;

    const renderer = new THREE.WebGLRenderer({
      canvas: filmCanvas,
      antialias: true,
      alpha: false
    });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10151d);
    const camera = new THREE.PerspectiveCamera(52, width / height, 0.01, 80);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x2b3340, 0.9);
    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(3.2, 5.2, 2.4);
    scene.add(hemi, key);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.MeshStandardMaterial({ color: 0x131a24, roughness: 0.95, metalness: 0.03 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    scene.add(floor);

    const panels = [];
    const texLoader = new THREE.TextureLoader();
    const fallbackCols = 5;
    for (let i = 0; i < sequence.length; i += 1) {
      const item = sequence[i];
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(PANEL_WIDTH_METERS, PANEL_HEIGHT_METERS),
        material
      );
      const placement = deserializePlacement(item.spatial);
      if (placement?.position && placement?.quaternion) {
        mesh.position.copy(placement.position);
        mesh.quaternion.copy(placement.quaternion);
      } else {
        const row = Math.floor(i / fallbackCols);
        const col = i % fallbackCols;
        mesh.position.set((col - 2) * 1.12, 1.45, -2.1 - row * 0.68);
      }

      if (typeof item.snapshot === "string" && item.snapshot.startsWith("data:image")) {
        const texture = await loadTextureFromUrl(texLoader, item.snapshot);
        if (texture) {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          material.map = texture;
          material.needsUpdate = true;
        }
      }

      mesh.visible = false;
      panels.push({ mesh, material });
      scene.add(mesh);
    }

    const bounds = new THREE.Box3();
    for (const panel of panels) {
      bounds.expandByObject(panel.mesh);
    }
    const center = new THREE.Vector3();
    bounds.getCenter(center);
    if (!Number.isFinite(center.x)) {
      center.set(0, 1.45, -2.4);
    }
    const size = new THREE.Vector3();
    bounds.getSize(size);
    const radius = THREE.MathUtils.clamp(size.length() * 0.48, 1.8, 5.6);

    const stream = filmCanvas.captureStream(30);
    const mimeType = pickRecordingMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    const chunks = [];

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    const stopPromise = new Promise((resolve) => {
      recorder.addEventListener("stop", () => resolve());
    });

    recorder.start();
    setFilmStatus(`Recording film in spatial layout (${panels.length} panels)...`);

    const durationMs = Math.max(6200, panels.length * 1100);
    const startTs = performance.now();
    const renderLoopPromise = new Promise((resolve) => {
      const renderFrame = (now) => {
        const t = Math.min(1, (now - startTs) / durationMs);
        const revealCount = Math.max(1, Math.ceil(t * panels.length));
        for (let i = 0; i < panels.length; i += 1) {
          panels[i].mesh.visible = i < revealCount;
        }

        const angle = t * Math.PI * 1.35 + Math.PI * 0.22;
        camera.position.set(
          center.x + Math.sin(angle) * radius,
          center.y + 0.7 + Math.sin(t * Math.PI) * 0.16,
          center.z + Math.cos(angle) * radius
        );
        camera.lookAt(center.x, center.y + 0.15, center.z);
        renderer.render(scene, camera);
        setFilmStatus(`Recording film (${Math.round(t * 100)}%)...`);

        if (t < 1) {
          window.requestAnimationFrame(renderFrame);
          return;
        }
        recorder.stop();
        resolve();
      };
      window.requestAnimationFrame(renderFrame);
    });

    await renderLoopPromise;

    await stopPromise;

    const blobType = mimeType || "video/webm";
    const blob = new Blob(chunks, { type: blobType });
    if (!blob.size) {
      setFilmStatus("Film export failed: empty recording.", true);
      return;
    }

    const ext = blobType.includes("mp4") ? "mp4" : "webm";
    const url = URL.createObjectURL(blob);
    updateFilmDownload(url, `argolis-archive-film.${ext}`);
    setFilmStatus("Film ready.");

    await waitMs(180);
    renderer.dispose();
    for (const panel of panels) {
      panel.material.map?.dispose?.();
      panel.material.dispose();
      panel.mesh.geometry.dispose();
    }
  } catch (error) {
    setFilmStatus(`Film export failed: ${error.message}`, true);
  } finally {
    archiveFilmRendering = false;
    renderFilmBtn.disabled = false;
  }
}

function restageLatestArchiveMoment() {
  const latest = getFilteredGalleryItems()
    .slice()
    .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0))[0];
  if (!latest) {
    setStatus("No archive moment available yet.", true);
    return;
  }
  const activeXr = xrRenderer?.xr.getSession();
  if (!activeXr || !xrScene || !xrHydraGeometry) {
    setStatus("Start AR first, then place latest moment.", true);
    return;
  }
  const ok = applyArchiveMoment(latest, true);
  if (ok) {
    setStatus(`Placed latest moment: ${new Date(latest.ts).toLocaleString()}`);
  }
}

function renderGallery() {
  galleryGrid.innerHTML = "";
  updateArchiveFilterUi();
  updateReplayUi();
  const visibleItems = getFilteredGalleryItems();

  if (galleryItems.length === 0) {
    const empty = document.createElement("p");
    empty.className = "gallery-empty";
    empty.textContent = "No placed moments yet.";
    galleryGrid.appendChild(empty);
    if (role === "archive") {
      rebuildArchiveViewer();
    }
    return;
  }

  if (visibleItems.length === 0) {
    const empty = document.createElement("p");
    empty.className = "gallery-empty";
    empty.textContent = "No moments for this time range yet.";
    galleryGrid.appendChild(empty);
    if (role === "archive") {
      rebuildArchiveViewer();
    }
    return;
  }

  for (const item of visibleItems) {
    const card = document.createElement("article");
    card.className = "gallery-card";

    const img = document.createElement("img");
    img.src = item.snapshot;
    img.alt = `Placed panel ${new Date(item.ts).toLocaleString()}`;

    const meta = document.createElement("p");
    meta.className = "gallery-meta";
    meta.textContent = `${new Date(item.ts).toLocaleString()} • ${item.mode}`;

    const actions = document.createElement("div");
    actions.className = "gallery-actions";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.textContent = "Load Code";
    loadBtn.dataset.action = "load";
    loadBtn.dataset.id = item.id;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.dataset.action = "delete";
    deleteBtn.dataset.id = item.id;

    actions.appendChild(loadBtn);
    actions.appendChild(deleteBtn);

    if (item.sketch_id) {
      const link = document.createElement("a");
      link.href = `https://hydra.ojack.xyz/?sketch_id=${item.sketch_id}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "gallery-sketch-link";
      link.textContent = `sketch ${item.sketch_id}`;
      card.appendChild(link);
    }

    card.appendChild(img);
    card.appendChild(meta);
    card.appendChild(actions);
    galleryGrid.appendChild(card);
  }

  if (role === "archive") {
    rebuildArchiveViewer();
  }
}

function handleGalleryAction(event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const id = target.dataset.id;
  const action = target.dataset.action;
  if (!id || !action) {
    return;
  }

  const item = galleryItems.find((entry) => entry.id === id);
  if (!item) {
    return;
  }

  if (action === "load") {
    applyHydraCode(item.code);
    if (actingAsHost) {
      broadcastToViewers({ type: "code", code: item.code });
    }
    setStatus("Loaded code from gallery moment.");
    return;
  }

  if (action === "delete") {
    galleryItems = galleryItems.filter((entry) => entry.id !== id);
    saveGallery();
    renderGallery();
  }
}

function clearGallery() {
  galleryItems = [];
  stopArchiveReplay(false);
  saveGallery();
  renderGallery();
}

function executePanelCode(synth, code) {
  if (typeof synth.eval === "function") {
    synth.eval(code);
    return;
  }

  const runner = new Function(
    "synth",
    `
const {src, osc, noise, voronoi, shape, gradient, solid, render, s0, s1, s2, s3, o0, o1, o2, o3} = synth;
${code}
`
  );
  runner(synth);
}

function createPanelEngine(code) {
  const panelCanvas = document.createElement("canvas");
  panelCanvas.width = PANEL_RUNNER_WIDTH;
  panelCanvas.height = PANEL_RUNNER_HEIGHT;
  panelCanvas.style.width = "320px";
  panelCanvas.style.height = "180px";
  panelRunnerMount.appendChild(panelCanvas);

  try {
    const instance = new Hydra({
      canvas: panelCanvas,
      detectAudio: false,
      width: PANEL_RUNNER_WIDTH,
      height: PANEL_RUNNER_HEIGHT,
      makeGlobal: false
    });
    const synth = instance.synth || instance;
    if (synth?.s0?.init) {
      synth.s0.init({ src: webcam });
    }
    executePanelCode(synth, code);
    return { canvas: panelCanvas, synth };
  } catch (error) {
    panelCanvas.remove();
    console.warn("Dedicated panel runner failed:", error);
    return null;
  }
}

function createPanelMaterial(code) {
  const panelEngine = createPanelEngine(code);
  const snapshotFrame = captureHydraFrame();

  if (panelEngine) {
    const texture = new THREE.CanvasTexture(panelEngine.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide
    });

    return {
      material,
      texture,
      panelEngine,
      snapshot: snapshotFrame.toDataURL("image/jpeg", 0.88)
    };
  }

  const texture = new THREE.CanvasTexture(snapshotFrame);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide
  });

  return {
    material,
    texture,
    panelEngine: null,
    snapshot: snapshotFrame.toDataURL("image/jpeg", 0.88)
  };
}

function updatePlacedPanelTextures() {
  for (const panel of placedPanels) {
    if (panel.texture) {
      panel.texture.needsUpdate = true;
    }
  }
}

function disposePanelEngine(panelEngine) {
  if (!panelEngine) {
    return;
  }
  try {
    panelEngine.synth?.hush?.();
  } catch {
    // ignore cleanup errors
  }
  panelEngine.canvas?.remove();
}

function freezePanelRunner(entry) {
  if (!entry?.panelEngine) {
    return;
  }

  const freezeCanvas = document.createElement("canvas");
  freezeCanvas.width = entry.panelEngine.canvas.width;
  freezeCanvas.height = entry.panelEngine.canvas.height;
  const ctx = freezeCanvas.getContext("2d");
  ctx.drawImage(entry.panelEngine.canvas, 0, 0, freezeCanvas.width, freezeCanvas.height);

  const frozenTexture = new THREE.CanvasTexture(freezeCanvas);
  frozenTexture.colorSpace = THREE.SRGBColorSpace;
  frozenTexture.minFilter = THREE.LinearFilter;
  frozenTexture.magFilter = THREE.LinearFilter;

  entry.material.map = frozenTexture;
  entry.material.needsUpdate = true;
  entry.texture.dispose();
  entry.texture = frozenTexture;

  disposePanelEngine(entry.panelEngine);
  entry.panelEngine = null;
}

function countActiveRunners() {
  let n = 0;
  for (const panel of placedPanels) {
    if (panel.panelEngine) {
      n += 1;
    }
  }
  return n;
}

function freezeAllRunnersExceptNewest() {
  for (let i = 0; i < placedPanels.length - 1; i += 1) {
    freezePanelRunner(placedPanels[i]);
  }
}

function trackPlacedPanel(entry) {
  placedPanels.push(entry);
}

function disposePlacedPanel(entry) {
  entry.scene.remove(entry.mesh);
  entry.material.dispose();
  entry.texture.dispose();
  entry.mesh.geometry.dispose();
  disposePanelEngine(entry.panelEngine);
}

function removeLastPanel() {
  clearArConfirmUntil = 0;
  overlayClearBtn.textContent = "Clear All";
  const panel = placedPanels.pop();
  if (!panel) {
    setStatus("No placed panel to remove.");
    return;
  }

  disposePlacedPanel(panel);
  setStatus("Removed last placed panel.");
}

function clearPlacedPanels() {
  while (placedPanels.length > 0) {
    disposePlacedPanel(placedPanels.pop());
  }
  setStatus("Cleared all placed panels.");
}

function clearPlacedPanelsWithConfirm() {
  const now = Date.now();
  if (now > clearArConfirmUntil) {
    clearArConfirmUntil = now + 1600;
    overlayClearBtn.textContent = "Tap Again to Clear";
    setStatus("Tap 'Clear All' again to confirm.");
    return;
  }

  clearPlacedPanels();
  clearArConfirmUntil = 0;
  overlayClearBtn.textContent = "Clear All";
}

async function setupCamera() {
  webcam = document.createElement("video");
  webcam.autoplay = true;
  webcam.muted = true;
  webcam.playsInline = true;

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false
  });

  webcam.srcObject = stream;
  await webcam.play();
}

function initHydra() {
  hydra = new Hydra({
    canvas,
    detectAudio: false,
    width: canvas.clientWidth,
    height: canvas.clientHeight
  });

  s0.init({ src: webcam });
}

function isQuickLookCapable() {
  const ua = navigator.userAgent || "";
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (!isIOS) {
    return false;
  }

  const anchor = document.createElement("a");
  return !!anchor.relList?.supports?.("ar");
}

async function detectArMode() {
  const supportsArWebXr =
    window.isSecureContext &&
    !!navigator.xr?.isSessionSupported &&
    (await navigator.xr.isSessionSupported("immersive-ar").catch(() => false));

  if (supportsArWebXr) {
    arMode = "webxr";
    arBtn.textContent = "Start AR";
    arBtn.disabled = false;
  } else if (isQuickLookCapable()) {
    arMode = "quicklook";
    arBtn.textContent = "Open AR (iOS)";
    arBtn.disabled = false;
  } else {
    arMode = "unsupported";
    arBtn.textContent = "Start AR on Phone";
    arBtn.disabled = true;
  }

  if (arMode === "unsupported") {
    setStatus("AR is not available here. Open the viewer link on a smartphone.");
  }
}

async function startArExperience() {
  try {
    setArchiveAutoplay(false);
    stopArchiveReplay(false);
    if (archiveViewerRoot) {
      archiveViewerRoot.hidden = true;
    }
    const activeVr = vrRenderer?.xr.getSession();
    if (activeVr) {
      await activeVr.end();
    }

    if (arMode === "webxr") {
      await toggleArSession();
      return;
    }

    if (arMode === "quicklook") {
      openQuickLook();
      return;
    }

    setStatus("AR is not available here. Open the viewer link on a smartphone.");
  } catch (error) {
    setStatus(`AR failed: ${error.message}`, true);
  }
}

function updateVrPanelFocus() {
  if (!vrArchivePanels.length) {
    return;
  }
  for (let i = 0; i < vrArchivePanels.length; i += 1) {
    const panel = vrArchivePanels[i];
    const isActive = i === vrFocusIndex;
    panel.mesh.scale.setScalar(isActive ? 1.08 : 1.0);
    panel.material.color.setHex(isActive ? 0xffffff : 0xe8f2ff);
  }

  const active = vrArchivePanels[vrFocusIndex];
  if (active) {
    setStatus(
      `VR moment ${vrFocusIndex + 1}/${vrArchivePanels.length}: ${new Date(active.item.ts).toLocaleString()}`
    );
  }
}

function focusNextVrPanel(step = 1) {
  if (!vrArchivePanels.length) {
    setStatus("No archived moments to browse in VR.", true);
    return;
  }
  vrFocusIndex = (vrFocusIndex + step + vrArchivePanels.length) % vrArchivePanels.length;
  updateVrPanelFocus();
}

function createVrArchivePanel(item, index, count) {
  const material = new THREE.MeshBasicMaterial({
    color: 0xe8f2ff,
    side: THREE.DoubleSide
  });
  const geometry = new THREE.PlaneGeometry(PANEL_WIDTH_METERS, PANEL_HEIGHT_METERS);
  const mesh = new THREE.Mesh(geometry, material);

  const ring = (Math.PI * 2 * index) / Math.max(1, count);
  const radius = 1.9 + (index % 3) * 0.18;
  const height = 1.45 + ((index % 4) - 1.5) * 0.09;
  mesh.position.set(Math.sin(ring) * radius, height, -Math.cos(ring) * radius);
  mesh.lookAt(0, 1.5, 0);

  if (typeof item.snapshot === "string" && item.snapshot.startsWith("data:image")) {
    new THREE.TextureLoader().load(item.snapshot, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      material.map = texture;
      material.needsUpdate = true;
    });
  }

  return { mesh, material, item };
}

function clearVrArchivePanels() {
  for (const panel of vrArchivePanels) {
    vrScene?.remove(panel.mesh);
    panel.mesh.geometry.dispose();
    panel.material.map?.dispose?.();
    panel.material.dispose();
  }
  vrArchivePanels = [];
  vrFocusIndex = 0;
}

function buildVrArchiveRoom() {
  clearVrArchivePanels();

  const items = getFilteredGalleryItems()
    .slice()
    .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0))
    .slice(-24);

  if (items.length === 0) {
    const fallback = {
      id: "live-preview",
      snapshot: captureHydraFrame().toDataURL("image/jpeg", 0.88),
      code: codeEditor.value,
      mode: "vr",
      ts: Date.now()
    };
    items.push(fallback);
  }

  items.forEach((item, idx) => {
    const panel = createVrArchivePanel(item, idx, items.length);
    vrArchivePanels.push(panel);
    vrScene.add(panel.mesh);
  });
  vrFocusIndex = 0;
  updateVrPanelFocus();
}

function initVrScene() {
  if (vrRenderer) {
    return;
  }

  vrRenderer = new THREE.WebGLRenderer({ antialias: true });
  vrRenderer.xr.enabled = true;
  vrRenderer.setPixelRatio(window.devicePixelRatio);
  vrRenderer.setSize(window.innerWidth, window.innerHeight);
  vrRenderer.domElement.style.position = "fixed";
  vrRenderer.domElement.style.inset = "0";
  vrRenderer.domElement.style.zIndex = "999";

  vrScene = new THREE.Scene();
  vrScene.background = new THREE.Color(0x0b0f18);
  vrCamera = new THREE.PerspectiveCamera();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x2d3542, 1.05);
  vrScene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(2, 4, 1.5);
  vrScene.add(dir);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(5.5, 64),
    new THREE.MeshStandardMaterial({ color: 0x101725, roughness: 0.98, metalness: 0.02 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  vrScene.add(floor);

  const rings = new THREE.GridHelper(10, 26, 0x2a3e60, 0x16243b);
  rings.position.y = 0.001;
  vrScene.add(rings);

  vrController = vrRenderer.xr.getController(0);
  vrController.addEventListener("select", () => focusNextVrPanel(1));
  vrScene.add(vrController);
}

function onVrFrame() {
  vrRenderer.render(vrScene, vrCamera);
}

function onVrSessionEnded() {
  vrRenderer.setAnimationLoop(null);
  clearVrArchivePanels();

  if (vrRenderer.domElement.parentNode) {
    vrRenderer.domElement.parentNode.removeChild(vrRenderer.domElement);
  }

  hideArOverlay();
  setAppVisible(true);
  setStatus("VR session ended.");
}

async function startVrExperience() {
  if (vrMode !== "webxr") {
    setStatus("VR is not available in this browser/device.", true);
    return;
  }

  try {
    const activeAr = xrRenderer?.xr.getSession();
    if (activeAr) {
      await activeAr.end();
    }

    initVrScene();
    buildVrArchiveRoom();
    const session = await navigator.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor"]
    });

    session.addEventListener("end", onVrSessionEnded);
    await vrRenderer.xr.setSession(session);
    document.body.appendChild(vrRenderer.domElement);
    setAppVisible(false);
    showArOverlay("Exit VR", async () => {
      const active = vrRenderer?.xr.getSession();
      if (active) {
        await active.end();
      }
    }, "vr");
    vrRenderer.setAnimationLoop(onVrFrame);
    setStatus("VR archive live. Use Prev/Next or controller trigger to browse moments.");
  } catch (error) {
    setStatus(`VR failed: ${error.message}`, true);
  }
}

function openQuickLook() {
  const link = document.createElement("a");
  link.setAttribute("rel", "ar");
  link.href = QUICK_LOOK_USDZ;
  link.style.display = "none";

  const img = document.createElement("img");
  img.alt = "AR Quick Look";
  link.appendChild(img);

  document.body.appendChild(link);
  link.click();
  link.remove();

  setStatus("Opened iOS Quick Look.");
}

function initArScene() {
  if (xrRenderer) {
    return;
  }

  xrRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  xrRenderer.xr.enabled = true;
  xrRenderer.setPixelRatio(window.devicePixelRatio);
  xrRenderer.setSize(window.innerWidth, window.innerHeight);
  xrRenderer.domElement.style.position = "fixed";
  xrRenderer.domElement.style.inset = "0";
  xrRenderer.domElement.style.zIndex = "999";

  xrScene = new THREE.Scene();
  xrCamera = new THREE.PerspectiveCamera();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1.1);
  xrScene.add(hemi);

  xrHydraGeometry = new THREE.PlaneGeometry(PANEL_WIDTH_METERS, PANEL_HEIGHT_METERS);

  const reticleGeo = new THREE.RingGeometry(0.06, 0.09, 32);
  reticleGeo.rotateX(-Math.PI / 2);
  xrReticle = new THREE.Mesh(
    reticleGeo,
    new THREE.MeshBasicMaterial({ color: 0x5de9ff })
  );
  xrReticle.matrixAutoUpdate = false;
  xrReticle.visible = false;
  xrScene.add(xrReticle);

  xrWallReticle = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_WIDTH_METERS * 0.36, PANEL_HEIGHT_METERS * 0.36),
    new THREE.MeshBasicMaterial({
      color: 0x5de9ff,
      wireframe: true
    })
  );
  xrWallReticle.matrixAutoUpdate = false;
  xrWallReticle.visible = false;
  xrScene.add(xrWallReticle);

  xrController = xrRenderer.xr.getController(0);
  xrController.addEventListener("select", onArSelect);
  xrScene.add(xrController);
}

function addPanelAt(scene, geometry, placement) {
  const { material, texture, panelEngine, snapshot } = createPanelMaterial(codeEditor.value);
  const plane = new THREE.Mesh(geometry.clone(), material);

  if (placement?.position) {
    plane.position.copy(placement.position);
  } else if (placement?.isVector3) {
    plane.position.copy(placement);
  } else {
    plane.position.set(0, 0, -1.4);
  }

  if (placement?.quaternion) {
    plane.quaternion.copy(placement.quaternion);
  } else {
    plane.quaternion.identity();
  }

  const baseNormal =
    placement?.normal?.clone?.().normalize?.() || new THREE.Vector3(0, 1, 0);
  let pushAmount = FLOOR_PANEL_OFFSET_M;
  if (placement?.kind === "wall") {
    pushAmount = placement.source === "estimated" ? ESTIMATED_WALL_OFFSET_M : WALL_PANEL_OFFSET_M;
  }
  const pushNormal = baseNormal.multiplyScalar(pushAmount);
  plane.position.add(pushNormal);

  if (placement?.kind === "floor") {
    setStatus("Placed on floor target.");
  } else if (placement?.kind === "wall" && placement?.source === "estimated") {
    setStatus("Placed on estimated wall. Add texture/edges on wall for better tracking.");
  } else {
    setStatus("Placed on wall target.");
  }

  scene.add(plane);
  trackPlacedPanel({
    mesh: plane,
    material,
    texture,
    panelEngine,
    scene
  });

  freezeAllRunnersExceptNewest();

  while (countActiveRunners() > MAX_ACTIVE_RUNNERS) {
    const oldestLive = placedPanels.find((entry) => entry.panelEngine);
    if (!oldestLive) {
      break;
    }
    freezePanelRunner(oldestLive);
  }

  if (placedPanels.length > MAX_PLACED_PANELS) {
    const oldest = placedPanels.shift();
    disposePlacedPanel(oldest);
  }

  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    snapshot,
    code: codeEditor.value,
    sketch_id: currentSketchId,
    spatial: serializePlacement(placement),
    mode: arMode,
    ts: Date.now()
  };

  addGalleryItem(
    item.snapshot,
    item.code,
    item.mode,
    item.id,
    item.ts,
    item.sketch_id,
    item.spatial
  );

  if (role === "viewer") {
    sendToHost({ type: "gallery-item", item });
  } else if (actingAsHost) {
    broadcastToViewers({ type: "gallery-item", item });
  }
}

function onArSelect() {
  if (currentReticleSurface) {
    addPanelAt(xrScene, xrHydraGeometry, currentReticleSurface);
    return;
  }

  setStatus("No stable surface detected yet. Scan slowly and include edges/texture.");
}

function pointInPolygon2D(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-8) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function getBestWallFromPlanes(frame, cameraPos, cameraForward, refSpace) {
  const planes = frame.detectedPlanes;
  if (!planes || planes.size === 0) {
    return null;
  }

  const plusY = new THREE.Vector3(0, 1, 0);
  const plusZ = new THREE.Vector3(0, 0, 1);
  const worldUp = new THREE.Vector3(0, 1, 0);
  let best = null;

  for (const plane of planes) {
    const pose = frame.getPose(plane.planeSpace, refSpace);
    if (!pose) {
      continue;
    }

    const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const planePos = new THREE.Vector3().setFromMatrixPosition(matrix);
    const quat = new THREE.Quaternion().setFromRotationMatrix(matrix);
    for (const axis of [plusY, plusZ]) {
      const rawNormal = axis.clone().applyQuaternion(quat).normalize();
      const verticality = 1 - Math.abs(rawNormal.dot(worldUp));
      if (verticality < 0.78) {
        continue;
      }

      let normal = rawNormal.clone();
      if (normal.dot(cameraPos.clone().sub(planePos)) < 0) {
        normal.negate();
      }
      normal.y = 0;
      if (normal.lengthSq() < 0.08) {
        continue;
      }
      normal.normalize();

      const denom = normal.dot(cameraForward);
      if (Math.abs(denom) < 0.16) {
        continue;
      }
      const t = normal.dot(planePos.clone().sub(cameraPos)) / denom;
      if (t < 0.25 || t > 6.0) {
        continue;
      }
      const hitPos = cameraPos.clone().add(cameraForward.clone().multiplyScalar(t));

      if (plane.polygon && plane.polygon.length >= 3) {
        const inv = matrix.clone().invert();
        const local = hitPos.clone().applyMatrix4(inv);
        const poly2d = plane.polygon.map((p) => ({ x: p.x, y: p.z }));
        if (!pointInPolygon2D({ x: local.x, y: local.z }, poly2d)) {
          continue;
        }
      }

      const wallQuat = new THREE.Quaternion().setFromUnitVectors(plusZ, normal);
      const score = verticality + 1 / Math.max(1, t);
      const candidate = {
        kind: "wall",
        score,
        position: hitPos,
        quaternion: wallQuat,
        normal,
        source: "plane"
      };
      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }
  }

  return best;
}

function projectPointToLockedWall(cameraPos, cameraForward, lockedWall) {
  if (!lockedWall?.normal || !lockedWall?.position) {
    return null;
  }
  const denom = lockedWall.normal.dot(cameraForward);
  if (Math.abs(denom) < 0.06) {
    return null;
  }
  const t = lockedWall.normal.dot(lockedWall.position.clone().sub(cameraPos)) / denom;
  if (t < 0.2 || t > 8.0) {
    return null;
  }
  return cameraPos.clone().add(cameraForward.clone().multiplyScalar(t));
}

function buildEstimatedWallSurface(cameraPos, cameraForward, distance = 1.2) {
  const plusZ = new THREE.Vector3(0, 0, 1);
  const forwardFlat = cameraForward.clone();
  forwardFlat.y = 0;
  if (forwardFlat.lengthSq() < 0.01) {
    forwardFlat.set(0, 0, -1);
  }
  forwardFlat.normalize();

  const wallPos = cameraPos.clone().add(forwardFlat.clone().multiplyScalar(distance));
  wallPos.y = cameraPos.y - 0.08;
  const wallNormal = cameraPos.clone().sub(wallPos);
  wallNormal.y = 0;
  if (wallNormal.lengthSq() < 0.01) {
    wallNormal.set(0, 0, 1);
  }
  wallNormal.normalize();

  return {
    kind: "wall",
    score: -0.2,
    position: wallPos,
    quaternion: new THREE.Quaternion().setFromUnitVectors(plusZ, wallNormal),
    normal: wallNormal,
    source: "estimated"
  };
}

function selectAutoSurface(bestFloor, bestWall, cameraForward) {
  if (!bestFloor && !bestWall) {
    return null;
  }
  if (!bestFloor) {
    return bestWall;
  }
  if (!bestWall) {
    return bestFloor;
  }

  const lookingDown = cameraForward.y < -0.35;
  const lookingForward = Math.abs(cameraForward.y) < 0.32;
  let wallScore = bestWall.score;
  let floorScore = bestFloor.score;

  if (lookingForward) {
    wallScore += 0.18;
  }
  if (lookingDown) {
    floorScore += 0.22;
  }
  if (bestWall.source === "plane") {
    wallScore += 0.08;
  }

  let selected = wallScore >= floorScore ? bestWall : bestFloor;
  const scoreGap = Math.abs(wallScore - floorScore);
  const now = Date.now();
  if (lastAutoSurfaceKind && now - lastAutoSurfaceTs < AUTO_SURFACE_STICKY_MS && scoreGap < 0.16) {
    if (lastAutoSurfaceKind === "wall" && bestWall) {
      selected = bestWall;
    } else if (lastAutoSurfaceKind === "floor" && bestFloor) {
      selected = bestFloor;
    }
  }

  lastAutoSurfaceKind = selected.kind;
  lastAutoSurfaceTs = now;
  return selected;
}

async function startArSession() {
  initArScene();

  const session = await navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["dom-overlay", "local-floor", "plane-detection"],
    domOverlay: { root: document.body }
  });

  session.addEventListener("end", onArSessionEnded);
  await xrRenderer.xr.setSession(session);
  document.body.appendChild(xrRenderer.domElement);
  const enabledFeatures = session.enabledFeatures;
  if (enabledFeatures && typeof enabledFeatures.includes === "function") {
    xrPlaneDetectionEnabled = enabledFeatures.includes("plane-detection");
  } else if (enabledFeatures && typeof enabledFeatures.has === "function") {
    xrPlaneDetectionEnabled = enabledFeatures.has("plane-detection");
  } else {
    xrPlaneDetectionEnabled = false;
  }
  xrPlaneDetectionSeen = false;
  lastPlaneHintTs = 0;
  lastWallDebugTs = 0;
  lastAutoSurfaceKind = null;
  lastAutoSurfaceTs = 0;

  const viewerSpace = await session.requestReferenceSpace("viewer");
  xrFloorHitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  if (typeof XRRay === "function") {
    const wallRays = [
      new XRRay({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }),
      new XRRay({ x: 0, y: 0, z: 0 }, { x: 0, y: 0.12, z: -1 }),
      new XRRay({ x: 0, y: 0, z: 0 }, { x: 0.08, y: 0.12, z: -1 }),
      new XRRay({ x: 0, y: 0, z: 0 }, { x: -0.08, y: 0.12, z: -1 })
    ];
    for (const wallRay of wallRays) {
      try {
        const source = await session.requestHitTestSource({
          space: viewerSpace,
          offsetRay: wallRay
        });
        xrWallHitTestSources.push(source);
      } catch {
        // Some engines may reject specific rays; keep other sources alive.
      }
    }
  }
  xrRefSpace = await session.requestReferenceSpace("local");

  setAppVisible(false);
  showArOverlay("Exit AR", async () => {
    try {
      const active = xrRenderer?.xr.getSession();
      if (active) {
        await active.end();
      }
    } catch {
      onArSessionEnded();
    }
  });

  xrRenderer.setAnimationLoop(onArFrame);
  if (xrPlaneDetectionEnabled) {
    setStatus(
      "AR running. Auto placement active. Tip: plain white walls track poorly; use edges/texture/light."
    );
  } else {
    setStatus("WebXR AR running. Plane detection not exposed by this browser.");
  }
}

function onArFrame(_, frame) {
  if (clearArConfirmUntil > 0 && Date.now() > clearArConfirmUntil) {
    clearArConfirmUntil = 0;
    overlayClearBtn.textContent = "Clear All";
  }

  if (frame && xrRefSpace && (xrFloorHitTestSource || xrWallHitTestSources.length > 0)) {
    const floorHits = xrFloorHitTestSource ? frame.getHitTestResults(xrFloorHitTestSource) : [];
    const wallHits = [];
    for (const source of xrWallHitTestSources) {
      for (const hit of frame.getHitTestResults(source)) {
        wallHits.push(hit);
      }
    }
    const hitResults = wallHits.concat(floorHits);
    const xrCam = xrRenderer.xr.getCamera(xrCamera);
      const cameraPos = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld);
      const cameraForward = new THREE.Vector3();
      xrCam.getWorldDirection(cameraForward);
      if (cameraForward.lengthSq() < 0.01) {
        cameraForward.set(0, 0, -1);
      }
      cameraForward.normalize();
      const cameraForwardFlat = cameraForward.clone();
      cameraForwardFlat.y = 0;
      if (cameraForwardFlat.lengthSq() < 0.01) {
        cameraForwardFlat.set(0, 0, -1);
      }
      cameraForwardFlat.normalize();
      const worldUp = new THREE.Vector3(0, 1, 0);
      const plusY = new THREE.Vector3(0, 1, 0);
      const plusZ = new THREE.Vector3(0, 0, 1);
      const scale = new THREE.Vector3(1, 1, 1);

      let bestFloor = null;
      let bestWall = null;
      const planeWall = getBestWallFromPlanes(frame, cameraPos, cameraForward, xrRefSpace);
      if (planeWall) {
        xrPlaneDetectionSeen = true;
      }
      if (planeWall) {
        bestWall = planeWall;
      }

      // Fallback: derive wall candidates directly from dedicated wall rays.
      for (const result of wallHits) {
        const pose = result.getPose(xrRefSpace);
        if (!pose) {
          continue;
        }
        const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
        const hitPos = new THREE.Vector3().setFromMatrixPosition(matrix);
        const toHit = hitPos.clone().sub(cameraPos);
        const toHitFlat = toHit.clone();
        toHitFlat.y = 0;
        if (toHitFlat.lengthSq() < 0.02) {
          continue;
        }
        const forwardAlign = cameraForwardFlat.dot(toHitFlat.clone().normalize());
        const camDistance = toHit.length();
        const heightDiff = Math.abs(hitPos.y - cameraPos.y);
        if (camDistance < 0.12 || camDistance > 8.0 || forwardAlign < 0.02 || heightDiff > 2.5) {
          continue;
        }

        const wallNormal = cameraPos.clone().sub(hitPos);
        wallNormal.y = 0;
        if (wallNormal.lengthSq() < 0.02) {
          continue;
        }
        wallNormal.normalize();

        const wallQuat = new THREE.Quaternion().setFromUnitVectors(plusZ, wallNormal);
        const score =
          0.6 +
          forwardAlign * 0.45 -
          Math.min(0.45, heightDiff * 0.2) -
          Math.min(0.25, camDistance * 0.03);
        const wallCandidate = {
          kind: "wall",
          score,
          position: hitPos.clone(),
          quaternion: wallQuat,
          normal: wallNormal,
          source: "hit-test"
        };
        if (!bestWall || wallCandidate.score > bestWall.score) {
          bestWall = wallCandidate;
        }
      }

      if (!bestWall && wallHits.length > 0) {
        const pose = wallHits[0].getPose(xrRefSpace);
        if (pose) {
          const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
          const hitPos = new THREE.Vector3().setFromMatrixPosition(matrix);
          const wallNormal = cameraPos.clone().sub(hitPos);
          wallNormal.y = 0;
          if (wallNormal.lengthSq() < 0.001) {
            wallNormal.set(0, 0, 1);
          }
          wallNormal.normalize();
          bestWall = {
            kind: "wall",
            score: 0.15,
            position: hitPos,
            quaternion: new THREE.Quaternion().setFromUnitVectors(plusZ, wallNormal),
            normal: wallNormal,
            source: "hit-test"
          };
        }
      }

      for (const result of hitResults) {
        const pose = result.getPose(xrRefSpace);
        if (!pose) {
          continue;
        }

        const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
        const hitPos = new THREE.Vector3().setFromMatrixPosition(matrix);
        const hitQuat = new THREE.Quaternion().setFromRotationMatrix(matrix);

        for (const axis of [plusY, plusZ]) {
          const rawNormal = axis.clone().applyQuaternion(hitQuat).normalize();
          if (rawNormal.lengthSq() < 0.5) {
            continue;
          }

          const floorNormal =
            rawNormal.dot(worldUp) < 0 ? rawNormal.clone().negate() : rawNormal.clone();
          const floorScore = Math.abs(floorNormal.dot(worldUp));
          const floorQuat = new THREE.Quaternion().setFromUnitVectors(plusZ, floorNormal);
          const floorCandidate = {
            kind: "floor",
            score: floorScore,
            position: hitPos.clone(),
            quaternion: floorQuat,
            normal: floorNormal
          };
          if (!bestFloor || floorCandidate.score > bestFloor.score) {
            bestFloor = floorCandidate;
          }

          const toCamera = cameraPos.clone().sub(hitPos);
          const facingNormal =
            rawNormal.dot(toCamera) < 0 ? rawNormal.clone().negate() : rawNormal.clone();
          const wallNormal = facingNormal.clone();
          wallNormal.y = 0;
          if (wallNormal.lengthSq() < 0.05) {
            continue;
          }
          wallNormal.normalize();

          const verticality = 1 - Math.abs(facingNormal.dot(worldUp));
          const camDistance = hitPos.distanceTo(cameraPos);
          const heightDiff = Math.abs(hitPos.y - cameraPos.y);
          const wallScore = verticality - Math.max(0, 0.45 - heightDiff);
          const wallQuat = new THREE.Quaternion().setFromUnitVectors(plusZ, wallNormal);
          const wallCandidate = {
            kind: "wall",
            score: wallScore,
            position: hitPos.clone(),
            quaternion: wallQuat,
            normal: wallNormal,
            camDistance,
            heightDiff,
            source: "hit-test"
          };

          const passesWallGate =
            wallCandidate.score > 0.45 &&
            wallCandidate.camDistance > 0.25 &&
            wallCandidate.heightDiff < 1.8;
          if (passesWallGate && (!bestWall || wallCandidate.score > bestWall.score)) {
            bestWall = wallCandidate;
          }
        }
      }

      let selected = selectAutoSurface(bestFloor, bestWall, cameraForward);

      if (!selected && lastLockedWallSurface) {
        const wallAge = Date.now() - lastLockedWallTs;
        if (wallAge < WALL_LOCK_KEEP_MS && cameraForward.y > -0.28) {
          const projected = projectPointToLockedWall(
            cameraPos,
            cameraForward,
            lastLockedWallSurface
          );
          if (projected) {
            selected = {
              kind: "wall",
              score: 0.1,
              position: projected,
              quaternion: lastLockedWallSurface.quaternion.clone(),
              normal: lastLockedWallSurface.normal.clone(),
              source: "locked"
            };
          }
        }
      }
      if (!selected && cameraForward.y > -0.3) {
        selected = buildEstimatedWallSurface(cameraPos, cameraForward, 1.2);
      }
      if (selected?.kind === "floor") {
        xrReticle.matrix.compose(selected.position, selected.quaternion, scale);
        xrReticle.visible = true;
        xrWallReticle.visible = false;
        currentReticleSurface = selected;
      } else if (selected?.kind === "wall") {
        const estimated = selected.source === "estimated";
        if (xrWallReticle.material?.color) {
          xrWallReticle.material.color.setHex(estimated ? 0xffcd00 : 0x5de9ff);
          xrWallReticle.material.needsUpdate = true;
        }
        xrWallReticle.matrix.compose(selected.position, selected.quaternion, scale);
        xrWallReticle.visible = true;
        xrReticle.visible = false;
        currentReticleSurface = selected;
        lastLockedWallSurface = {
          position: selected.position.clone(),
          quaternion: selected.quaternion.clone(),
          normal: selected.normal.clone()
        };
        lastLockedWallTs = Date.now();
      } else {
        xrReticle.visible = false;
        xrWallReticle.visible = false;
        currentReticleSurface = null;
        const now = Date.now();
        if (xrPlaneDetectionEnabled && !xrPlaneDetectionSeen && cameraForward.y > -0.28) {
          if (now - lastPlaneHintTs > TRACKING_HINT_COOLDOWN_MS) {
            setStatus(
              "Wall tracking is weak. Plain white walls are hard to detect; scan slowly and include edges/colors."
            );
            lastPlaneHintTs = now;
          }
        } else if (now - lastWallDebugTs > 1200) {
          setStatus("Scanning surfaces...");
          lastWallDebugTs = now;
        }
      }

      const now = Date.now();
      if (selected?.kind === "wall" && selected?.source === "estimated") {
        if (now - lastWallDebugTs > 1200) {
          setStatus("Estimating wall position. For precise placement, scan slowly with edges/texture.");
          lastWallDebugTs = now;
        }
      } else if (selected?.kind === "wall") {
        if (now - lastWallDebugTs > 1200) {
          setStatus("Wall target ready.");
          lastWallDebugTs = now;
        }
      } else if (selected?.kind === "floor" && now - lastWallDebugTs > 1200) {
        setStatus("Floor target ready.");
        lastWallDebugTs = now;
      }
  }

  updatePlacedPanelTextures();
  xrRenderer.render(xrScene, xrCamera);
}

function onArSessionEnded() {
  xrRenderer.setAnimationLoop(null);
  stopArchiveReplay(false);

  if (xrRenderer.domElement.parentNode) {
    xrRenderer.domElement.parentNode.removeChild(xrRenderer.domElement);
  }

  xrFloorHitTestSource?.cancel();
  xrFloorHitTestSource = null;
  for (const source of xrWallHitTestSources) {
    source?.cancel?.();
  }
  xrWallHitTestSources.length = 0;
  xrRefSpace = null;
  xrPlaneDetectionEnabled = false;
  xrPlaneDetectionSeen = false;
  lastPlaneHintTs = 0;
  lastWallDebugTs = 0;
  lastLockedWallSurface = null;
  lastLockedWallTs = 0;
  lastAutoSurfaceKind = null;
  lastAutoSurfaceTs = 0;
  if (xrReticle) {
    xrReticle.visible = false;
  }
  if (xrWallReticle) {
    xrWallReticle.visible = false;
  }
  currentReticleSurface = null;

  hideArOverlay();
  setAppVisible(true);
  if (role === "controller") {
    setPanelVisibility(galleryPanel, toggleGalleryBtn, true);
  }
  setStatus("WebXR AR session ended.");
}

async function toggleArSession() {
  const active = xrRenderer?.xr.getSession();
  if (active) {
    await active.end();
    return;
  }
  await startArSession();
}

function initDesktopArScene() {
  if (desktopRenderer) {
    return;
  }

  desktopRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  desktopRenderer.setPixelRatio(window.devicePixelRatio);
  desktopRenderer.setSize(window.innerWidth, window.innerHeight);
  desktopRenderer.domElement.style.position = "fixed";
  desktopRenderer.domElement.style.inset = "0";
  desktopRenderer.domElement.style.zIndex = "999";
  desktopRenderer.domElement.style.touchAction = "none";

  desktopScene = new THREE.Scene();
  desktopCamera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.01,
    100
  );
  desktopCamera.position.set(0, 1.45, 0.1);

  const ambient = new THREE.HemisphereLight(0xffffff, 0x2a2a2a, 1.1);
  desktopScene.add(ambient);

  desktopHydraGeometry = new THREE.PlaneGeometry(PANEL_WIDTH_METERS, PANEL_HEIGHT_METERS);
  desktopRenderer.domElement.addEventListener("pointerdown", onDesktopPointerDown);
}

function computeComfortDistance(planeWidth, viewportCoverage = 0.46) {
  const fovRad = THREE.MathUtils.degToRad(desktopCamera.fov);
  const visibleWidthAtUnitDistance = 2 * Math.tan(fovRad / 2) * desktopCamera.aspect;
  return planeWidth / (visibleWidthAtUnitDistance * viewportCoverage);
}

function placeDesktopSeedPanel() {
  const direction = new THREE.Vector3(0, -0.05, -1).normalize();
  const distance = computeComfortDistance(1.2, 0.5);
  const point = desktopCamera.position.clone().add(direction.multiplyScalar(distance));
  addPanelAt(desktopScene, desktopHydraGeometry, desktopCamera.position, point);
}

function onDesktopPointerDown(event) {
  if (!desktopActive) {
    return;
  }

  const rect = desktopRenderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, desktopCamera);

  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const hasHit = raycaster.ray.intersectPlane(ground, hit);

  if (hasHit) {
    addPanelAt(desktopScene, desktopHydraGeometry, desktopCamera.position, hit);
    return;
  }

  const fallback = raycaster.ray.origin
    .clone()
    .add(raycaster.ray.direction.clone().multiplyScalar(1.8));
  addPanelAt(desktopScene, desktopHydraGeometry, desktopCamera.position, fallback);
}

function desktopAnimate() {
  if (!desktopActive) {
    return;
  }

  updatePlacedPanelTextures();
  desktopRenderer.render(desktopScene, desktopCamera);
  desktopRaf = requestAnimationFrame(desktopAnimate);
}

function startDesktopArSession() {
  initDesktopArScene();

  webcam.style.position = "fixed";
  webcam.style.inset = "0";
  webcam.style.width = "100vw";
  webcam.style.height = "100vh";
  webcam.style.objectFit = "cover";
  webcam.style.zIndex = "998";
  webcam.style.pointerEvents = "none";

  if (!webcam.parentNode) {
    document.body.appendChild(webcam);
  }

  if (!desktopRenderer.domElement.parentNode) {
    document.body.appendChild(desktopRenderer.domElement);
  }

  desktopActive = true;
  setAppVisible(false);
  showArOverlay("Exit Desktop AR", () => toggleDesktopArSession());

  if (!desktopHasSeedPanel) {
    placeDesktopSeedPanel();
    desktopHasSeedPanel = true;
  }

  desktopAnimate();
  setStatus("Desktop AR running. Click/tap to place animated moments.");
}

function stopDesktopArSession() {
  desktopActive = false;
  cancelAnimationFrame(desktopRaf);

  if (desktopRenderer?.domElement.parentNode) {
    desktopRenderer.domElement.parentNode.removeChild(desktopRenderer.domElement);
  }

  if (webcam?.parentNode) {
    webcam.parentNode.removeChild(webcam);
  }

  hideArOverlay();
  setAppVisible(true);
  setStatus("Desktop AR session ended.");
}

function toggleDesktopArSession() {
  if (desktopActive) {
    stopDesktopArSession();
    return;
  }

  startDesktopArSession();
}

function onWindowResize() {
  if (xrRenderer) {
    xrRenderer.setSize(window.innerWidth, window.innerHeight);
  }

  if (vrRenderer) {
    vrRenderer.setSize(window.innerWidth, window.innerHeight);
  }

  if (archiveRenderer && archiveCanvas && archiveCamera) {
    const width = archiveCanvas.clientWidth || window.innerWidth;
    const height = archiveCanvas.clientHeight || Math.floor(window.innerHeight * 0.64);
    archiveRenderer.setSize(width, height, false);
    archiveCamera.aspect = width / Math.max(1, height);
    archiveCamera.updateProjectionMatrix();
  }

  if (desktopRenderer && desktopCamera) {
    desktopCamera.aspect = window.innerWidth / window.innerHeight;
    desktopCamera.updateProjectionMatrix();
    desktopRenderer.setSize(window.innerWidth, window.innerHeight);
  }
}

function bindEvents() {
  toggleSyncBtn?.addEventListener("click", () => {
    triggerShareFromDock();
  });
  toggleGalleryBtn?.addEventListener("click", toggleGalleryPanel);
  openShareSessionBtn?.addEventListener("click", toggleShareSessionDetails);

  runBtn?.addEventListener("click", () => {
    currentSketchId = null;
    applyHydraCode(codeEditor.value);
    if (actingAsHost) {
      broadcastToViewers({ type: "code", code: codeEditor.value });
    }
  });

  resetBtn?.addEventListener("click", () => {
    currentSketchId = null;
    codeEditor.value = defaultCode;
    applyHydraCode(codeEditor.value);
    if (actingAsHost) {
      broadcastToViewers({ type: "code", code: codeEditor.value });
    }
  });

  randomBtn?.addEventListener("click", applyRandomSnippet);

  arBtn?.addEventListener("click", startArExperience);

  hostBtn?.addEventListener("click", () => {
    role = "controller";
    updateRoleUI();
    hostSession();
  });

  joinBtn?.addEventListener("click", () => {
    role = "viewer";
    updateRoleUI();
    joinSession();
  });

  copyLinkBtn?.addEventListener("click", shareViewerLink);
  qrLinkBtn?.addEventListener("click", showViewerQr);
  publishArchiveBtn?.addEventListener("click", publishArchiveLink);
  renderFilmBtn?.addEventListener("click", renderArchiveFilm);
  qrCloseBtn?.addEventListener("click", () => qrDialog?.close());
  archivePrevBtn?.addEventListener("click", () => focusArchivePanel(archiveFocusIndex - 1));
  archiveNextBtn?.addEventListener("click", () => focusArchivePanel(archiveFocusIndex + 1));
  archiveAutoplayBtn?.addEventListener("click", () => {
    setArchiveAutoplay(!archiveAutoplayTimer);
  });
  archiveControlsToggleBtn?.addEventListener("click", toggleArchiveControls);

  const bindOverlayAction = (btn, action) => {
    let lastTs = 0;
    let pointerHandled = false;
    const invoke = (event, source) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }

      const now = Date.now();
      if (now - lastTs < 320) {
        return;
      }
      lastTs = now;

      try {
        action();
      } catch (error) {
        setStatus(`Overlay action failed (${source}): ${error.message}`, true);
      }
    };

    const invokeVisible = (event, source) => {
      if (!overlayRoot.hidden) {
        invoke(event, source);
      }
    };

    btn.addEventListener(
      "pointerup",
      (event) => {
        pointerHandled = true;
        invokeVisible(event, "pointerup");
        window.setTimeout(() => {
          pointerHandled = false;
        }, 450);
      },
      { passive: false }
    );
    btn.addEventListener(
      "click",
      (event) => {
        if (pointerHandled) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        invokeVisible(event, "click");
      },
      { passive: false }
    );
  };

  if (overlayExitBtn) {
    bindOverlayAction(overlayExitBtn, () => currentExitAction?.());
  }
  if (overlayRestageLatestBtn) {
    bindOverlayAction(overlayRestageLatestBtn, restageLatestArchiveMoment);
  }
  if (overlayUndoBtn) {
    bindOverlayAction(overlayUndoBtn, removeLastPanel);
  }
  if (overlayClearBtn) {
    bindOverlayAction(overlayClearBtn, clearPlacedPanelsWithConfirm);
  }
  if (overlayReplayStartBtn) {
    bindOverlayAction(overlayReplayStartBtn, startArchiveReplay);
  }
  if (overlayReplayNextBtn) {
    bindOverlayAction(overlayReplayNextBtn, () => stepArchiveReplay(true));
  }
  if (overlayReplayStopBtn) {
    bindOverlayAction(overlayReplayStopBtn, () => stopArchiveReplay(true));
  }
  windowAllBtn.addEventListener("click", () => {
    archiveWindowFilter = "all";
    renderGallery();
  });
  windowWeekBtn.addEventListener("click", () => {
    archiveWindowFilter = "week";
    renderGallery();
  });
  windowTodayBtn.addEventListener("click", () => {
    archiveWindowFilter = "today";
    renderGallery();
  });

  galleryGrid.addEventListener("click", handleGalleryAction);
  clearGalleryBtn.addEventListener("click", clearGallery);
  window.addEventListener("resize", onWindowResize);
}

function autoSetupSession() {
  roomId = urlParams.get("room") || randomRoomId();
  roomIdInput.value = roomId;

  if (role === "viewer" || role === "archive") {
    joinSession();
  } else {
    hostSession();
  }
}

async function start() {
  if (role !== "archive" && !navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera API is not supported in this browser.", true);
    return;
  }

  if (role === "archive") {
    role = "viewer";
  }

  galleryItems = loadGallery();
  renderGallery();
  updateRoleUI();
  setPanelVisibility(syncPanel, toggleSyncBtn, false);
  setPanelVisibility(galleryPanel, toggleGalleryBtn, false);
  if (shareSessionDetails) {
    shareSessionDetails.hidden = true;
  }
  if (openShareSessionBtn) {
    openShareSessionBtn.textContent = "Share AR Session";
    openShareSessionBtn.setAttribute("aria-expanded", "false");
  }
  bindEvents();
  codeEditor.value = "";

  try {
    await setupCamera();
    initHydra();
    await detectArMode();
    autoSetupSession();
    const loadedRandom = await applyStartupSnippet();

    if (role === "viewer") {
      if (arMode === "unsupported") {
        setStatus("Viewer ready. Open the viewer link on a smartphone for AR.");
      } else {
        setStatus(
          loadedRandom
            ? "Viewer ready. Random Hydra starter loaded. Start AR and place moments."
            : "Viewer ready. Start AR and place moments."
        );
      }
    } else {
      if (arMode === "unsupported") {
        setStatus(
          loadedRandom
            ? "Host ready. Random Hydra starter loaded."
            : "Host ready. Edit code here; AR placement happens on the smartphone viewer."
        );
      } else {
        setStatus(
          loadedRandom
            ? "Host ready. Random Hydra starter loaded."
            : "Host ready. Edit code here, place on viewer device."
        );
      }
    }
  } catch (error) {
    setStatus(`Startup failed: ${error.message}`, true);
  }
}

start();
