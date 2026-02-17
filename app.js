const canvas = document.getElementById("hydra-canvas");
const codeEditor = document.getElementById("hydra-code");
const runBtn = document.getElementById("run-btn");
const resetBtn = document.getElementById("reset-btn");
const statusEl = document.getElementById("status");

let hydra;
let webcam;

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
    bindEvents();
    runHydraCode();
    setStatus("Camera initialized. Edit the code and press Run.");
  } catch (error) {
    setStatus(`Startup failed: ${error.message}`, true);
  }
}

start();
