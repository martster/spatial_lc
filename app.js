import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js";

const canvas = document.getElementById("hydra-canvas");
const codeEditor = document.getElementById("hydra-code");
const runBtn = document.getElementById("run-btn");
const resetBtn = document.getElementById("reset-btn");
const arBtn = document.getElementById("ar-btn");
const statusEl = document.getElementById("status");
const appRoot = document.querySelector(".app");

const roleChip = document.getElementById("role-chip");
const roomIdInput = document.getElementById("room-id");
const hostBtn = document.getElementById("host-btn");
const joinBtn = document.getElementById("join-btn");
const copyLinkBtn = document.getElementById("copy-link-btn");
const syncStatusEl = document.getElementById("sync-status");

const overlayRoot = document.getElementById("ar-overlay");
const overlayExitBtn = document.getElementById("overlay-exit-btn");
const overlayUndoBtn = document.getElementById("overlay-undo-btn");
const overlayClearBtn = document.getElementById("overlay-clear-btn");

const galleryGrid = document.getElementById("gallery-grid");
const clearGalleryBtn = document.getElementById("clear-gallery-btn");

const QUICK_LOOK_USDZ =
  "https://modelviewer.dev/shared-assets/models/Astronaut.usdz";
const GALLERY_KEY = "spatial_lc_gallery_v2";

let hydra;
let webcam;
let arMode = "desktop";

let xrRenderer;
let xrScene;
let xrCamera;
let xrController;
let xrReticle;
let xrHydraGeometry;
let xrHitTestSource = null;
let xrRefSpace = null;

let desktopRenderer;
let desktopScene;
let desktopCamera;
let desktopHydraGeometry;
let desktopActive = false;
let desktopRaf = 0;
let desktopHasSeedPanel = false;

let peer;
let roomId = "";
let actingAsHost = false;
let hostConn = null;
const viewerConnections = new Set();

const placedPanels = [];
let galleryItems = [];

const urlParams = new URLSearchParams(window.location.search);
let role = resolveRole();

const defaultCode = `
solid(0.01, 0.02, 0.04)
  .layer(
    osc(6, 0.04, 1.5)
      .kaleid(5)
      .rotate(() => time * 0.06)
      .color(1.0, 0.44, 0.18)
      .luma(0.2)
  )
  .layer(
    noise(3, 0.08)
      .color(0.08, 0.82, 0.92)
      .luma(0.45)
      .blend(solid(), 0.55)
  )
  .modulate(osc(12, 0.03, 0.4), 0.05)
  .layer(
    src(s0)
      .saturate(0.25)
      .contrast(1.12)
      .luma(0.42)
      .blend(solid(), 0.55)
  )
  .out(o0)

render(o0)
`.trim();

function resolveRole() {
  const explicit = urlParams.get("role");
  if (explicit === "viewer" || explicit === "controller") {
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
}

function setSyncStatus(message, isError = false) {
  syncStatusEl.textContent = message;
  syncStatusEl.classList.toggle("error", isError);
}

function setAppVisible(visible) {
  appRoot.style.display = visible ? "" : "none";
}

function showArOverlay(exitLabel, onExit) {
  overlayRoot.hidden = false;
  overlayExitBtn.textContent = exitLabel;
  overlayExitBtn.onclick = onExit;
  overlayUndoBtn.onclick = () => removeLastPanel();
  overlayClearBtn.onclick = () => clearPlacedPanels();
}

function hideArOverlay() {
  overlayRoot.hidden = true;
  overlayExitBtn.onclick = null;
  overlayUndoBtn.onclick = null;
  overlayClearBtn.onclick = null;
}

function randomRoomId() {
  return `spatial-${Math.random().toString(36).slice(2, 8)}`;
}

function debounce(fn, waitMs) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), waitMs);
  };
}

function updateRoleUI() {
  roleChip.textContent = `Role: ${role}`;
  if (role === "viewer") {
    document.body.classList.add("viewer-role");
    codeEditor.readOnly = true;
    arBtn.disabled = false;
  } else {
    document.body.classList.remove("viewer-role");
    codeEditor.readOnly = false;
  }
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

function broadcastToViewers(payload) {
  for (const conn of viewerConnections) {
    if (conn.open) {
      conn.send(payload);
    }
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

const pushCodeDebounced = debounce(() => {
  if (role !== "controller") {
    return;
  }

  applyHydraCode(codeEditor.value);
  if (actingAsHost) {
    broadcastToViewers({ type: "code", code: codeEditor.value });
  }
}, 220);

function handleData(data, sourceConn = null) {
  if (!data || typeof data !== "object") {
    return;
  }

  if (data.type === "request-sync" && actingAsHost) {
    sourceConn?.send({ type: "code", code: codeEditor.value });
    return;
  }

  if (data.type === "code" && typeof data.code === "string") {
    applyHydraCode(data.code, true);
    if (role === "viewer") {
      setStatus("Remote code received.");
    }
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
    setSyncStatus(`Controller session live: ${roomId}`);
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
      updateUrlState("viewer", roomId);
      setSyncStatus(`Viewer connected to: ${roomId}`);
      hostConn.send({ type: "request-sync" });
    });

    hostConn.on("data", (data) => handleData(data));
    hostConn.on("close", () => {
      setSyncStatus("Disconnected from controller.", true);
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

async function copyViewerLink() {
  const room = (roomIdInput.value || "").trim();
  if (!room) {
    setSyncStatus("Start controller session first.", true);
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("role", "viewer");
  url.searchParams.set("room", room);

  try {
    await navigator.clipboard.writeText(url.toString());
    setSyncStatus("Viewer link copied.");
  } catch {
    setSyncStatus(`Viewer link: ${url.toString()}`);
  }
}

function loadGallery() {
  try {
    const raw = localStorage.getItem(GALLERY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveGallery() {
  localStorage.setItem(GALLERY_KEY, JSON.stringify(galleryItems.slice(0, 80)));
}

function renderGallery() {
  galleryGrid.innerHTML = "";

  if (galleryItems.length === 0) {
    const empty = document.createElement("p");
    empty.className = "gallery-empty";
    empty.textContent = "No placed moments yet.";
    galleryGrid.appendChild(empty);
    return;
  }

  for (const item of galleryItems) {
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

    card.appendChild(img);
    card.appendChild(meta);
    card.appendChild(actions);
    galleryGrid.appendChild(card);
  }
}

function addGalleryItem(snapshot, code, mode) {
  galleryItems.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    snapshot,
    code,
    mode,
    ts: Date.now()
  });

  saveGallery();
  renderGallery();
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
  saveGallery();
  renderGallery();
}

function captureSnapshotCanvas() {
  const width = canvas.width || Math.max(2, Math.floor(canvas.clientWidth * window.devicePixelRatio));
  const height = canvas.height || Math.max(2, Math.floor(canvas.clientHeight * window.devicePixelRatio));

  const snap = document.createElement("canvas");
  snap.width = width;
  snap.height = height;
  const ctx = snap.getContext("2d");
  ctx.drawImage(canvas, 0, 0, width, height);

  return {
    snapCanvas: snap,
    dataUrl: snap.toDataURL("image/jpeg", 0.9)
  };
}

function createSnapshotMaterial() {
  const { snapCanvas, dataUrl } = captureSnapshotCanvas();
  const texture = new THREE.CanvasTexture(snapCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide
  });

  return { material, texture, dataUrl };
}

function trackPlacedPanel(mesh, material, texture, scene) {
  placedPanels.push({ mesh, material, texture, scene });
}

function removeLastPanel() {
  const panel = placedPanels.pop();
  if (!panel) {
    setStatus("No placed panel to remove.");
    return;
  }

  panel.scene.remove(panel.mesh);
  panel.material.dispose();
  panel.texture.dispose();
  panel.mesh.geometry.dispose();
  setStatus("Removed last placed panel.");
}

function clearPlacedPanels() {
  while (placedPanels.length > 0) {
    removeLastPanel();
  }
  setStatus("Cleared all placed panels.");
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
  const supportsWebXr =
    window.isSecureContext &&
    !!navigator.xr?.isSessionSupported &&
    (await navigator.xr.isSessionSupported("immersive-ar").catch(() => false));

  if (supportsWebXr) {
    arMode = "webxr";
    arBtn.textContent = "Start AR";
    return;
  }

  if (isQuickLookCapable()) {
    arMode = "quicklook";
    arBtn.textContent = "Open AR (iOS)";
    return;
  }

  arMode = "desktop";
  arBtn.textContent = "Start Desktop AR";
}

async function startArExperience() {
  try {
    if (arMode === "webxr") {
      await toggleArSession();
      return;
    }

    if (arMode === "quicklook") {
      openQuickLook();
      return;
    }

    toggleDesktopArSession();
  } catch (error) {
    setStatus(`AR failed: ${error.message}`, true);
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

  xrHydraGeometry = new THREE.PlaneGeometry(1.2, 0.675);

  const reticleGeo = new THREE.RingGeometry(0.06, 0.09, 32);
  reticleGeo.rotateX(-Math.PI / 2);
  xrReticle = new THREE.Mesh(
    reticleGeo,
    new THREE.MeshBasicMaterial({ color: 0x7de4d1 })
  );
  xrReticle.matrixAutoUpdate = false;
  xrReticle.visible = false;
  xrScene.add(xrReticle);

  xrController = xrRenderer.xr.getController(0);
  xrController.addEventListener("select", onArSelect);
  xrScene.add(xrController);
}

function addPanelAt(scene, geometry, cameraPos, worldPos) {
  const { material, texture, dataUrl } = createSnapshotMaterial();
  const plane = new THREE.Mesh(geometry.clone(), material);
  plane.position.copy(worldPos);
  plane.position.y += 0.35;
  plane.lookAt(cameraPos.x, plane.position.y, cameraPos.z);

  scene.add(plane);
  trackPlacedPanel(plane, material, texture, scene);
  addGalleryItem(dataUrl, codeEditor.value, arMode);
}

function onArSelect() {
  if (!xrReticle?.visible) {
    return;
  }

  const cameraPos = new THREE.Vector3();
  const xrCam = xrRenderer.xr.getCamera(xrCamera);
  cameraPos.setFromMatrixPosition(xrCam.matrixWorld);

  const worldPos = new THREE.Vector3();
  worldPos.setFromMatrixPosition(xrReticle.matrix);

  addPanelAt(xrScene, xrHydraGeometry, cameraPos, worldPos);
}

async function startArSession() {
  initArScene();

  const session = await navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["dom-overlay", "local-floor"],
    domOverlay: { root: document.body }
  });

  session.addEventListener("end", onArSessionEnded);
  await xrRenderer.xr.setSession(session);
  document.body.appendChild(xrRenderer.domElement);

  const viewerSpace = await session.requestReferenceSpace("viewer");
  xrHitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  xrRefSpace = await session.requestReferenceSpace("local-floor");

  setAppVisible(false);
  showArOverlay("Exit AR", async () => {
    const active = xrRenderer?.xr.getSession();
    if (active) {
      await active.end();
    }
  });

  xrRenderer.setAnimationLoop(onArFrame);
  setStatus("WebXR AR running. Tap to place frozen moments.");
}

function onArFrame(_, frame) {
  if (frame && xrHitTestSource && xrRefSpace) {
    const hitResults = frame.getHitTestResults(xrHitTestSource);
    if (hitResults.length > 0) {
      const pose = hitResults[0].getPose(xrRefSpace);
      xrReticle.visible = true;
      xrReticle.matrix.fromArray(pose.transform.matrix);
    } else {
      xrReticle.visible = false;
    }
  }

  xrRenderer.render(xrScene, xrCamera);
}

function onArSessionEnded() {
  xrRenderer.setAnimationLoop(null);

  if (xrRenderer.domElement.parentNode) {
    xrRenderer.domElement.parentNode.removeChild(xrRenderer.domElement);
  }

  xrHitTestSource?.cancel();
  xrHitTestSource = null;
  xrRefSpace = null;
  if (xrReticle) {
    xrReticle.visible = false;
  }

  hideArOverlay();
  setAppVisible(true);
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

  desktopHydraGeometry = new THREE.PlaneGeometry(1.2, 0.675);
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
  const start = desktopCamera.position.clone();
  const point = start.add(direction.multiplyScalar(distance));
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
  setStatus("Desktop AR running. Click/tap to place frozen moments.");
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

  if (desktopRenderer && desktopCamera) {
    desktopCamera.aspect = window.innerWidth / window.innerHeight;
    desktopCamera.updateProjectionMatrix();
    desktopRenderer.setSize(window.innerWidth, window.innerHeight);
  }
}

function bindEvents() {
  runBtn.addEventListener("click", () => {
    applyHydraCode(codeEditor.value);
    if (actingAsHost) {
      broadcastToViewers({ type: "code", code: codeEditor.value });
    }
  });

  resetBtn.addEventListener("click", () => {
    codeEditor.value = defaultCode;
    applyHydraCode(codeEditor.value);
    if (actingAsHost) {
      broadcastToViewers({ type: "code", code: codeEditor.value });
    }
  });

  codeEditor.addEventListener("input", () => {
    if (role === "controller") {
      pushCodeDebounced();
    }
  });

  arBtn.addEventListener("click", startArExperience);

  hostBtn.addEventListener("click", () => {
    role = "controller";
    updateRoleUI();
    hostSession();
  });

  joinBtn.addEventListener("click", () => {
    role = "viewer";
    updateRoleUI();
    joinSession();
  });

  copyLinkBtn.addEventListener("click", copyViewerLink);
  galleryGrid.addEventListener("click", handleGalleryAction);
  clearGalleryBtn.addEventListener("click", clearGallery);
  window.addEventListener("resize", onWindowResize);
}

function autoSetupSession() {
  roomId = urlParams.get("room") || randomRoomId();
  roomIdInput.value = roomId;

  if (role === "viewer") {
    joinSession();
  } else {
    hostSession();
  }
}

async function start() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera API is not supported in this browser.", true);
    return;
  }

  galleryItems = loadGallery();
  renderGallery();
  updateRoleUI();
  bindEvents();
  codeEditor.value = defaultCode;

  try {
    await setupCamera();
    initHydra();
    await detectArMode();
    applyHydraCode(codeEditor.value);
    autoSetupSession();

    if (role === "viewer") {
      setStatus("Viewer ready. Start AR and place moments.");
    } else {
      setStatus("Controller ready. Live edits stream to viewers.");
    }
  } catch (error) {
    setStatus(`Startup failed: ${error.message}`, true);
  }
}

start();
