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

const QUICK_LOOK_USDZ =
  "https://modelviewer.dev/shared-assets/models/Astronaut.usdz";

let hydra;
let webcam;
let arMode = "desktop";
let overlayExitBtn;

let xrRenderer;
let xrScene;
let xrCamera;
let xrController;
let xrReticle;
let xrHydraTexture;
let xrHydraGeometry;
let xrHitTestSource = null;
let xrRefSpace = null;

let desktopRenderer;
let desktopScene;
let desktopCamera;
let desktopHydraTexture;
let desktopHydraGeometry;
let desktopActive = false;
let desktopRaf = 0;
let desktopHasSeedPanel = false;

let peer;
let roomId = "";
let actingAsHost = false;
let hostConn = null;
const viewerConnections = new Set();

const urlParams = new URLSearchParams(window.location.search);
let role = resolveRole();

const defaultCode = `
solid(0.02, 0.02, 0.05)
  .layer(
    osc(7, 0.03, 1.2)
      .kaleid(5)
      .rotate(() => time * 0.04)
      .color(0.98, 0.36, 0.2)
      .luma(0.22)
  )
  .modulate(noise(3.5, 0.08), 0.16)
  .layer(
    src(s0)
      .saturate(0.24)
      .contrast(1.2)
      .luma(0.35)
      .color(0.3, 0.72, 1.0)
      .blend(solid(), 0.45)
  )
  .out(o0)

render(o0)
`.trim();

function resolveRole() {
  const explicit = urlParams.get("role");
  if (explicit === "viewer" || explicit === "controller") {
    return explicit;
  }

  const isSmallTouch =
    (window.matchMedia("(max-width: 860px)").matches && navigator.maxTouchPoints > 0) ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");

  if (urlParams.get("room") && isSmallTouch) {
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

function ensureOverlayExitButton() {
  if (overlayExitBtn) {
    return;
  }

  overlayExitBtn = document.createElement("button");
  overlayExitBtn.id = "ar-exit-overlay";
  overlayExitBtn.type = "button";
  overlayExitBtn.textContent = "Exit AR";
  overlayExitBtn.style.display = "none";
  document.body.appendChild(overlayExitBtn);
}

function showOverlayExitButton(label, onClick) {
  ensureOverlayExitButton();
  overlayExitBtn.textContent = label;
  overlayExitBtn.onclick = onClick;
  overlayExitBtn.style.display = "inline-flex";
}

function hideOverlayExitButton() {
  if (!overlayExitBtn) {
    return;
  }
  overlayExitBtn.style.display = "none";
  overlayExitBtn.onclick = null;
}

function setAppVisible(visible) {
  if (!appRoot) {
    return;
  }
  appRoot.style.display = visible ? "" : "none";
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
    setSyncStatus(`Hosting room: ${roomId}`);
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
      setSyncStatus(`Joined room: ${roomId}`);
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

async function copyViewerLink() {
  const room = (roomIdInput.value || "").trim();
  if (!room) {
    setSyncStatus("Host first, then copy the viewer link.", true);
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
    arBtn.disabled = false;
    return;
  }

  if (isQuickLookCapable()) {
    arMode = "quicklook";
    arBtn.textContent = "Open AR (iOS)";
    arBtn.disabled = false;
    return;
  }

  arMode = "desktop";
  arBtn.textContent = "Start Desktop AR";
  arBtn.disabled = false;
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

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.1);
  xrScene.add(hemi);

  xrHydraTexture = new THREE.CanvasTexture(canvas);
  xrHydraTexture.colorSpace = THREE.SRGBColorSpace;
  xrHydraTexture.minFilter = THREE.LinearFilter;
  xrHydraTexture.magFilter = THREE.LinearFilter;

  xrHydraGeometry = new THREE.PlaneGeometry(1.2, 0.675);

  const reticleGeo = new THREE.RingGeometry(0.06, 0.08, 32);
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

function onArSelect() {
  if (!xrReticle?.visible) {
    return;
  }

  const material = new THREE.MeshBasicMaterial({
    map: xrHydraTexture,
    side: THREE.DoubleSide
  });

  const plane = new THREE.Mesh(xrHydraGeometry, material);

  const cameraPos = new THREE.Vector3();
  const xrCam = xrRenderer.xr.getCamera(xrCamera);
  cameraPos.setFromMatrixPosition(xrCam.matrixWorld);

  plane.position.setFromMatrixPosition(xrReticle.matrix);
  plane.position.y += 0.45;
  plane.lookAt(cameraPos.x, plane.position.y, cameraPos.z);
  xrScene.add(plane);
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
  setAppVisible(false);
  showOverlayExitButton("Exit AR", async () => {
    const active = xrRenderer?.xr.getSession();
    if (active) {
      await active.end();
    }
  });
  document.body.appendChild(xrRenderer.domElement);

  const viewerSpace = await session.requestReferenceSpace("viewer");
  xrHitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  xrRefSpace = await session.requestReferenceSpace("local-floor");

  xrRenderer.setAnimationLoop(onArFrame);
  setStatus("WebXR AR running. Tap to place Hydra panels.");
}

function onArFrame(_, frame) {
  if (xrHydraTexture) {
    xrHydraTexture.needsUpdate = true;
  }

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

  hideOverlayExitButton();
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

  const ambient = new THREE.HemisphereLight(0xffffff, 0x2d2d2d, 1.1);
  desktopScene.add(ambient);

  desktopHydraTexture = new THREE.CanvasTexture(canvas);
  desktopHydraTexture.colorSpace = THREE.SRGBColorSpace;
  desktopHydraTexture.minFilter = THREE.LinearFilter;
  desktopHydraTexture.magFilter = THREE.LinearFilter;

  desktopHydraGeometry = new THREE.PlaneGeometry(1.2, 0.675);
  desktopRenderer.domElement.addEventListener("pointerdown", onDesktopPointerDown);
}

function computeComfortDistance(planeWidth, viewportCoverage = 0.42) {
  const fovRad = THREE.MathUtils.degToRad(desktopCamera.fov);
  const visibleWidthAtUnitDistance = 2 * Math.tan(fovRad / 2) * desktopCamera.aspect;
  return planeWidth / (visibleWidthAtUnitDistance * viewportCoverage);
}

function placeDesktopPlane(worldPoint) {
  const material = new THREE.MeshBasicMaterial({
    map: desktopHydraTexture,
    side: THREE.DoubleSide
  });

  const plane = new THREE.Mesh(desktopHydraGeometry, material);
  plane.position.copy(worldPoint);
  plane.position.y += 0.35;
  plane.lookAt(desktopCamera.position.x, plane.position.y, desktopCamera.position.z);
  desktopScene.add(plane);
}

function placeDesktopSeedPanel() {
  const direction = new THREE.Vector3(0, -0.05, -1).normalize();
  const distance = computeComfortDistance(1.2, 0.5);
  const start = desktopCamera.position.clone();
  const point = start.add(direction.multiplyScalar(distance));
  placeDesktopPlane(point);
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
    placeDesktopPlane(hit);
    return;
  }

  const fallbackPoint = raycaster.ray.origin
    .clone()
    .add(raycaster.ray.direction.clone().multiplyScalar(1.8));
  placeDesktopPlane(fallbackPoint);
}

function desktopAnimate() {
  if (!desktopActive) {
    return;
  }

  if (desktopHydraTexture) {
    desktopHydraTexture.needsUpdate = true;
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
  showOverlayExitButton("Exit Desktop AR", () => toggleDesktopArSession());

  if (!desktopHasSeedPanel) {
    placeDesktopSeedPanel();
    desktopHasSeedPanel = true;
  }

  desktopAnimate();
  setStatus("Desktop AR running. Click/tap to place more panels.");
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

  hideOverlayExitButton();
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
      setStatus("Viewer mode ready. Start AR and receive live code.");
    } else {
      setStatus("Controller mode ready. Edits stream live to viewers.");
    }
  } catch (error) {
    setStatus(`Startup failed: ${error.message}`, true);
  }
}

start();
