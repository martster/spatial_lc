import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js";

const canvas = document.getElementById("hydra-canvas");
const codeEditor = document.getElementById("hydra-code");
const runBtn = document.getElementById("run-btn");
const resetBtn = document.getElementById("reset-btn");
const arBtn = document.getElementById("ar-btn");
const statusEl = document.getElementById("status");

let hydra;
let webcam;
let arSupported = false;

let xrRenderer;
let xrScene;
let xrCamera;
let xrController;
let xrReticle;
let xrHydraTexture;
let xrHydraGeometry;
let xrHitTestSource = null;
let xrRefSpace = null;

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
  // Request the environment camera on mobile where possible.
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

  // Bind webcam stream as the first Hydra source.
  s0.init({ src: webcam });
}

function runHydraCode() {
  try {
    // Evaluate the user script in the Hydra global context.
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
  arBtn.addEventListener("click", toggleArSession);
  window.addEventListener("resize", onWindowResize);
}

function onWindowResize() {
  if (!xrRenderer) {
    return;
  }
  xrRenderer.setSize(window.innerWidth, window.innerHeight);
}

async function detectArSupport() {
  if (!window.isSecureContext || !navigator.xr?.isSessionSupported) {
    arSupported = false;
    arBtn.disabled = true;
    return;
  }

  try {
    arSupported = await navigator.xr.isSessionSupported("immersive-ar");
  } catch {
    arSupported = false;
  }

  arBtn.disabled = !arSupported;
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
  if (!arSupported) {
    setStatus("WebXR AR is not supported on this device/browser.", true);
    return;
  }

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
  setStatus("AR running. Move device, then tap to place visuals.");
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
  xrReticle.visible = false;
  arBtn.textContent = "Start AR";
  setStatus("AR session ended.");
}

async function toggleArSession() {
  try {
    const active = xrRenderer?.xr.getSession();
    if (active) {
      await active.end();
      return;
    }
    await startArSession();
  } catch (error) {
    setStatus(`AR failed: ${error.message}`, true);
  }
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
    await detectArSupport();
    bindEvents();
    runHydraCode();
    if (arSupported) {
      setStatus("Camera initialized. Edit code, then start AR.");
    } else {
      setStatus("Camera initialized. AR is unavailable on this device/browser.");
    }
  } catch (error) {
    setStatus(`Startup failed: ${error.message}`, true);
  }
}

start();
