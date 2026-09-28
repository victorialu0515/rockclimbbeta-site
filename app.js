const API = {
  rockDetection: "https://2fnba1hgek.execute-api.us-east-2.amazonaws.com/default/rockDetection",
  hrnet: "https://6m0r9uz3n2.execute-api.us-east-2.amazonaws.com/default/hrnet",
  poseScore: "https://rmj82w72ic.execute-api.us-east-2.amazonaws.com/default/poseScore",
};

const TRACK_COLORS = ["#ff6b35", "#4ecdc4", "#ffd23f", "#6a5acd", "#ff4d6d", "#4dabf7", "#8de969", "#c77dff"];

const COCO_SKELETON = [
  [15, 13], [13, 11], [16, 14], [14, 12], [11, 12],
  [5, 11], [6, 12], [5, 6], [5, 7], [6, 8], [7, 9],
  [8, 10], [1, 2], [0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 6],
];

const video = document.getElementById("video");
const uploadedPreview = document.getElementById("uploadedPreview");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const stage = document.querySelector(".stage");
const stageMessage = document.getElementById("stageMessage");
const btnCamera = document.getElementById("btnCamera");
const btnScan = document.getElementById("btnScan");
const btnClimb = document.getElementById("btnClimb");
const btnStop = document.getElementById("btnStop");
const fileWall = document.getElementById("fileWall");
const fileClimb = document.getElementById("fileClimb");
const labelClimbUpload = document.getElementById("labelClimbUpload");
const trackPicker = document.getElementById("trackPicker");
const suggestionBar = document.getElementById("suggestionBar");
const suggestionText = document.getElementById("suggestionText");
const statusLog = document.getElementById("statusLog");

let holds = [];
let trackChosen = null;
let climbTimer = null;
let climbBusy = false;
let imageHeight = 0; // tracks whichever source (live video or an uploaded photo) is currently on stage

function log(msg) {
  const t = new Date().toLocaleTimeString();
  statusLog.textContent = `[${t}] ${msg}\n` + statusLog.textContent;
}

function setStageMessage(msg) {
  if (msg) {
    stageMessage.textContent = msg;
    stageMessage.classList.remove("hidden");
  } else {
    stageMessage.classList.add("hidden");
  }
}

function resizeCanvasTo(width, height) {
  canvas.width = width;
  canvas.height = height;
  imageHeight = height;
  stage.style.aspectRatio = `${width} / ${height}`;
}

function resizeCanvasToVideo() {
  stage.classList.remove("photo-mode");
  resizeCanvasTo(video.videoWidth, video.videoHeight);
}

function readFileAsB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function showUploadedImage(dataUrl) {
  return new Promise((resolve) => {
    uploadedPreview.onload = () => {
      stage.classList.add("photo-mode");
      resizeCanvasTo(uploadedPreview.naturalWidth, uploadedPreview.naturalHeight);
      resolve();
    };
    uploadedPreview.src = dataUrl;
  });
}

async function callApi(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || data.errorMessage || `HTTP ${res.status}`);
  }
  return data;
}

function captureFrameB64(quality = 0.85) {
  const tmp = document.createElement("canvas");
  tmp.width = video.videoWidth;
  tmp.height = video.videoHeight;
  tmp.getContext("2d").drawImage(video, 0, 0, tmp.width, tmp.height);
  return tmp.toDataURL("image/jpeg", quality).split(",")[1];
}

function trackColor(t) {
  return TRACK_COLORS[t % TRACK_COLORS.length];
}

function drawHolds(highlightTrack) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const h of holds) {
    const [cx, cy, w, hgt] = h.bbox;
    const isChosen = highlightTrack === null || highlightTrack === undefined || h.track === highlightTrack;
    ctx.strokeStyle = trackColor(h.track);
    ctx.lineWidth = isChosen ? 4 : 1.5;
    ctx.globalAlpha = isChosen ? 1 : 0.3;
    ctx.strokeRect(cx - w / 2, cy - hgt / 2, w, hgt);
  }
  ctx.globalAlpha = 1;
}

function validPoint(p) {
  return p && p[0] > 0 && p[1] > 0;
}

function drawSkeleton(poses) {
  if (!poses) return;
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#4ecdc4";
  ctx.fillStyle = "#4ecdc4";
  for (const [a, b] of COCO_SKELETON) {
    const pa = poses[a], pb = poses[b];
    if (!validPoint(pa) || !validPoint(pb)) continue;
    ctx.beginPath();
    ctx.moveTo(pa[0], pa[1]);
    ctx.lineTo(pb[0], pb[1]);
    ctx.stroke();
  }
  for (const p of poses) {
    if (!validPoint(p)) continue;
    ctx.beginPath();
    ctx.arc(p[0], p[1], 5, 0, 2 * Math.PI);
    ctx.fill();
  }
}

function parsePoint(s) {
  const nums = (s.match(/-?\d+\.?\d*/g) || []).map(Number);
  return [nums[0], nums[1]];
}

const LIMBS = [
  ["leftHand", "nextLeftHand", "left hand"],
  ["rightHand", "nextRightHand", "right hand"],
  ["leftFoot", "nextLeftFoot", "left foot"],
  ["rightFoot", "nextRightFoot", "right foot"],
];

function describeMove(move) {
  for (const [curKey, nextKey, label] of LIMBS) {
    if (move[curKey] !== move[nextKey]) return `Move your ${label}`;
  }
  return "Hold your position";
}

function drawSuggestion(move) {
  for (const [curKey, nextKey] of LIMBS) {
    if (move[curKey] === move[nextKey]) continue;
    const [x, y] = parsePoint(move[nextKey]);
    for (const [radius, color, width] of [[27, "#ffffff", 5], [27, "#ff6b35", 3]]) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  }
}

btnCamera.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    resizeCanvasToVideo();
    setStageMessage(null);
    btnCamera.disabled = true;
    btnScan.disabled = false;
    log("Camera ready.");
  } catch (e) {
    log("Camera error: " + e.message);
    setStageMessage("Could not access camera: " + e.message);
  }
});

async function runScan(image) {
  setStageMessage("Scanning wall…");
  try {
    const data = await callApi(API.rockDetection, { image, model_path: "models/best.pt" });
    holds = data.result_json.rocks;
    trackChosen = null;
    drawHolds(null);
    buildTrackPicker();
    log(`Scan complete: ${holds.length} holds detected.`);
    setStageMessage(null);
  } catch (e) {
    log("Scan failed: " + e.message);
    setStageMessage("Scan failed — try again.");
  }
}

btnScan.addEventListener("click", async () => {
  btnScan.disabled = true;
  await runScan(captureFrameB64());
  btnScan.disabled = false;
});

fileWall.addEventListener("change", async () => {
  const file = fileWall.files[0];
  if (!file) return;
  const b64 = await readFileAsB64(file);
  await showUploadedImage(`data:${file.type};base64,${b64}`);
  await runScan(b64);
  fileWall.value = "";
});

function buildTrackPicker() {
  const tracks = [...new Set(holds.map((h) => h.track))].sort((a, b) => a - b);
  trackPicker.innerHTML = "";
  trackPicker.hidden = false;
  tracks.forEach((t) => {
    const el = document.createElement("div");
    el.className = "track-swatch";
    el.innerHTML = `<span class="dot" style="background:${trackColor(t)}"></span> Track ${t + 1}`;
    el.addEventListener("click", () => {
      trackChosen = t;
      [...trackPicker.children].forEach((c) => c.classList.remove("selected"));
      el.classList.add("selected");
      drawHolds(t);
      btnClimb.disabled = false;
      labelClimbUpload.classList.remove("disabled");
      fileClimb.disabled = false;
      log(`Route set to track ${t + 1}.`);
    });
    trackPicker.appendChild(el);
  });
}

async function analyzeFrame(image) {
  try {
    const poseData = await callApi(API.hrnet, { image });
    drawHolds(trackChosen);

    if (!poseData.personDetected) {
      log("No person detected this frame.");
      return;
    }

    drawSkeleton(poseData.poses);

    const scoreData = await callApi(API.poseScore, {
      poses: poseData.poses,
      rock_json: { user_id: "demo", run_id: 0, track_chosen: trackChosen, rocks: holds },
      image_height: imageHeight,
      model_path: "linear_model.joblib",
    });

    const move = scoreData.nextMove;
    const label = move ? describeMove(move) : "No reachable holds on this track";
    suggestionBar.hidden = false;
    suggestionText.textContent = label;
    if (move) drawSuggestion(move);
    log("Suggestion: " + label);
  } catch (e) {
    log("Tick failed: " + e.message);
  }
}

async function climbTick() {
  if (climbBusy) return;
  climbBusy = true;
  await analyzeFrame(captureFrameB64(0.8));
  climbBusy = false;
}

btnClimb.addEventListener("click", () => {
  btnClimb.disabled = true;
  btnStop.disabled = false;
  stage.classList.remove("photo-mode");
  suggestionBar.hidden = false;
  log("Started suggesting moves.");
  climbTick();
  climbTimer = setInterval(climbTick, 2500);
});

btnStop.addEventListener("click", () => {
  clearInterval(climbTimer);
  climbTimer = null;
  btnClimb.disabled = false;
  btnStop.disabled = true;
  log("Stopped.");
});

fileClimb.addEventListener("change", async () => {
  const file = fileClimb.files[0];
  if (!file) return;
  clearInterval(climbTimer);
  climbTimer = null;
  btnClimb.disabled = false;
  btnStop.disabled = true;
  const b64 = await readFileAsB64(file);
  await showUploadedImage(`data:${file.type};base64,${b64}`);
  suggestionBar.hidden = false;
  await analyzeFrame(b64);
  fileClimb.value = "";
});
