import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js";

const canvas = document.getElementById("hydra-canvas");
const codeEditor = document.getElementById("hydra-code");
const runBtn = document.getElementById("run-btn");
const resetBtn = document.getElementById("reset-btn");
const arBtn = document.getElementById("ar-btn");
const statusEl = document.getElementById("status");

const QUICK_LOOK_USDZ =
  "https://modelviewer.dev/shared-assets/models/Astronaut.usdz";

let hydra;
let webcam;
let arMode = "desktop";

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

const defaultCode = `
// Camera source comes from s0.
src(s0)
  .colorama(() => 0.002 + Math.sin(time * 0.4) * 0.002)
  .modulate(noise(4, 0.1), 0.07)
  .layer(
    osc(16, 0.02, 0.7)
      .thresh(0.65)
      .color(0.2, 0.9, 0.8)
      .luma(0.3)
  )
  .out(o0)

render(o0)
`.trim();

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

async function setupCamera() {
  webcam = document.createElement("video");
  webcam.autoplay = true;
  webcam.muted = true;
  webcam.playsInline = true;

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" }
    },
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

function runHydraCode() {
  try {
    new Function(codeEditor.value)();
    setStatus("Script running.");
  } catch (error) {
    setStatus(`Error: ${error.message}`, true);
  }
}

function bindEvents() {
  runBtn.addEventListener("click", runHydraCode);
  resetBtn.addEventListener("click", () => {
    codeEditor.value = defaultCode;
    runHydraCode();
  });
  arBtn.addEventListener("click", startArExperience);
  window.addEventListener("resize", onWindowResize);
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

  setStatus("Opened iOS Quick Look. Hydra stays available in the web view.");
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
    new THREE.MeshBasicMaterial({ color: 0x41c7b9 })
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
  document.body.appendChild(xrRenderer.domElement);
  arBtn.textContent = "Exit AR";

  const viewerSpace = await session.requestReferenceSpace("viewer");
  xrHitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  xrRefSpace = await session.requestReferenceSpace("local-floor");

  xrRenderer.setAnimationLoop(onArFrame);
  setStatus("WebXR AR running. Move device, then tap to place visuals.");
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

  arBtn.textContent = "Start AR";
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
  desktopCamera.position.set(0, 1.4, 0.2);

  const ambient = new THREE.HemisphereLight(0xffffff, 0x222222, 1.15);
  desktopScene.add(ambient);

  desktopHydraTexture = new THREE.CanvasTexture(canvas);
  desktopHydraTexture.colorSpace = THREE.SRGBColorSpace;
  desktopHydraTexture.minFilter = THREE.LinearFilter;
  desktopHydraTexture.magFilter = THREE.LinearFilter;

  desktopHydraGeometry = new THREE.PlaneGeometry(1.2, 0.675);
  desktopRenderer.domElement.addEventListener("pointerdown", onDesktopPointerDown);
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
  arBtn.textContent = "Exit Desktop AR";
  desktopAnimate();

  setStatus("Desktop AR running. Click/tap to place Hydra panels.");
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

  arBtn.textContent = "Start Desktop AR";
  setStatus("Desktop AR session ended.");
}

function toggleDesktopArSession() {
  if (desktopActive) {
    stopDesktopArSession();
    return;
  }

  startDesktopArSession();
}

async function start() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera API is not supported in this browser.", true);
    return;
  }

  codeEditor.value = defaultCode;

  try {
    await setupCamera();
    initHydra();
    await detectArMode();
    bindEvents();
    runHydraCode();

    if (arMode === "webxr") {
      setStatus("Camera ready. WebXR AR detected. Press Start AR.");
    } else if (arMode === "quicklook") {
      setStatus("Camera ready. iOS Quick Look detected.");
    } else {
      setStatus("Camera ready. Desktop AR fallback detected.");
    }
  } catch (error) {
    setStatus(`Startup failed: ${error.message}`, true);
  }
}

start();
