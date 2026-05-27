(function () {
  "use strict";

  const BRAND = "PEPSCam";
  const PEER_PREFIX = "pepscam-v1";
  const STORAGE = {
    res: "pepscam_phone_res",
    fps: "pepscam_phone_fps",
    bitrate: "pepscam_phone_bitrate",
    customBitrate: "pepscam_phone_custom_bitrate",
    audio: "pepscam_phone_audio",
    camera: "pepscam_phone_camera",
    mic: "pepscam_phone_mic",
    performanceMode: "pepscam_phone_performance_mode"
  };

  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" }
    ]
  };

  const state = {
    roomId: "",
    targetCam: "1",
    peer: null,
    controlConn: null,
    mediaCall: null,
    myStream: null,
    videoTrack: null,
    audioTrack: null,
    qrStream: null,
    reconnectTimer: null,
    statsTimer: null,
    lastBytes: 0,
    lastTime: 0,
    sessionTotalBytes: 0,
    customBitrate: 2500,
    isUIRotated: false,
    mediaConnected: false
  };

  const $ = (id) => document.getElementById(id);

  function peerOptions() {
    return { debug: 1, config: rtcConfig };
  }

  function controlId(room) {
    return `${PEER_PREFIX}-${room}-control`;
  }

  function screenId(room, cam) {
    return `${PEER_PREFIX}-${room}-screen-${cam}`;
  }

  function cleanRoom(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 6);
  }

  function setText(id, text) {
    const node = $(id);
    if (node) node.textContent = text;
  }

  function setStatus(text, color) {
    setText("status-txt", text);
    const dot = $("status-dot");
    if (!dot) return;
    dot.style.background = color || "#facc15";
  }

  function saveSettings() {
    localStorage.setItem(STORAGE.res, $("res").value);
    localStorage.setItem(STORAGE.fps, $("fps").value);
    localStorage.setItem(STORAGE.bitrate, $("bitrate").value === "custom" ? String(state.customBitrate) : $("bitrate").value);
    localStorage.setItem(STORAGE.customBitrate, String(state.customBitrate));
    localStorage.setItem(STORAGE.audio, $("audio-enable").value);
    localStorage.setItem(STORAGE.performanceMode, $("performance-mode").value);
    localStorage.setItem(STORAGE.camera, $("camera-select").value);
    localStorage.setItem(STORAGE.mic, $("audio-source").value);
  }

  function loadSettings() {
    const res = localStorage.getItem(STORAGE.res);
    const fps = localStorage.getItem(STORAGE.fps);
    const bitrate = localStorage.getItem(STORAGE.bitrate);
    const custom = parseInt(localStorage.getItem(STORAGE.customBitrate) || "2500", 10);
    const audio = localStorage.getItem(STORAGE.audio);
    const performanceMode = localStorage.getItem(STORAGE.performanceMode);

    if (res) $("res").value = res;
    if (fps) $("fps").value = fps;
    if (audio) $("audio-enable").value = audio;
    if (performanceMode) $("performance-mode").value = performanceMode;
    if (Number.isFinite(custom)) state.customBitrate = custom;

    if (bitrate) {
      const existing = Array.from($("bitrate").options).some((option) => option.value === bitrate);
      if (existing) {
        $("bitrate").value = bitrate;
      } else {
        addCustomBitrateOption($("bitrate"), bitrate);
        $("bitrate").value = bitrate;
        state.customBitrate = parseInt(bitrate, 10);
      }
    }
  }

  function addCustomBitrateOption(select, bitrate) {
    const value = String(bitrate);
    if (Array.from(select.options).some((option) => option.value === value)) return;
    const option = new Option(`Custom (${value})`, value);
    select.insertBefore(option, select.querySelector('option[value="custom"]') || null);
  }

  async function initDeviceSelection() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn("getUserMedia is not available in this browser.");
      return;
    }

    try {
      const tmpStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      tmpStream.getTracks().forEach((track) => track.stop());
    } catch (err) {
      console.warn("Initial device permission skipped", err);
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoSelects = [$("camera-select"), $("live-cam-select")];
      const audioSelects = [$("audio-source"), $("live-mic-select")];

      clearDeviceOptions(videoSelects, "Default (Rear/Auto)");
      clearDeviceOptions(audioSelects, "Default (Auto)");

      let cameraCount = 1;
      let micCount = 1;
      devices.forEach((device) => {
        if (device.kind === "videoinput") {
          const label = device.label || `Camera ${cameraCount}`;
          videoSelects.forEach((select) => select.add(new Option(label, device.deviceId)));
          cameraCount += 1;
        } else if (device.kind === "audioinput") {
          const label = device.label || `Microphone ${micCount}`;
          audioSelects.forEach((select) => select.add(new Option(label, device.deviceId)));
          micCount += 1;
        }
      });

      const savedCam = localStorage.getItem(STORAGE.camera);
      const savedMic = localStorage.getItem(STORAGE.mic);
      if (savedCam) $("camera-select").value = savedCam;
      if (savedMic) $("audio-source").value = savedMic;
    } catch (err) {
      console.warn("Device enumeration failed", err);
    }
  }

  function clearDeviceOptions(selects, firstLabel) {
    selects.forEach((select, index) => {
      select.innerHTML = "";
      select.add(new Option(index === 0 ? firstLabel : (firstLabel.includes("Rear") ? "Change Lens..." : "Change Mic..."), ""));
    });
  }

  function toggleSettingsModal(show) {
    $("settings-ui").classList.toggle("active", Boolean(show));
  }

  function checkCustomBitrate(select) {
    if (select.value !== "custom") {
      state.customBitrate = parseInt(select.value, 10) || 2500;
      saveSettings();
      return;
    }

    const value = prompt("Bitrate (kbps):", String(state.customBitrate));
    const parsed = parseInt(value || "", 10);
    if (Number.isFinite(parsed) && parsed >= 300) {
      state.customBitrate = parsed;
      addCustomBitrateOption(select, parsed);
      select.value = String(parsed);
      saveSettings();
    } else {
      select.value = String(state.customBitrate);
    }
  }

  function checkRoomConfig() {
    const room = cleanRoom($("room-id").value);
    $("room-id").value = room;
    const nameBox = $("setup-room-name");
    if (room.length === 6) {
      nameBox.classList.add("active");
      setText("setup-room-name-text", `Room ${room}`);
    } else {
      nameBox.classList.remove("active");
    }
  }

  async function ensurePeer() {
    if (!window.Peer) {
      throw new Error("PeerJS library not loaded");
    }
    if (state.peer && !state.peer.destroyed && state.peer.open) return state.peer;

    if (state.peer && !state.peer.destroyed) {
      state.peer.destroy();
    }

    state.peer = new Peer(undefined, peerOptions());
    state.peer.on("connection", (conn) => {
      conn.on("data", handleControlMessage);
    });
    state.peer.on("error", (err) => {
      console.warn("[PEPSCam peer]", err);
      if (err && err.type !== "peer-unavailable") setStatus("SIGNAL ERROR", "#ef4444");
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Signaling timeout")), 12000);
      state.peer.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      state.peer.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    return state.peer;
  }

  async function startStreaming() {
    state.roomId = cleanRoom($("room-id").value);
    state.targetCam = String(parseInt($("cam-index").value || "1", 10));

    if (state.roomId.length !== 6) {
      alert("กรุณาใส่ Room ID 6 หลัก");
      return;
    }

    saveSettings();

    try {
      await startLocalMedia();
      $("setup").classList.add("hidden");
      $("live-ui").classList.remove("hidden");
      setText("room-info", `Room: ${state.roomId}`);
      syncLiveSelectors();
      setStatus("CONNECTING...", "#facc15");

      await ensurePeer();
      connectControl();
      connectOBS();
      startReconnectLoop();
      startUpdatingStats();
      await initDeviceSelection();
    } catch (err) {
      alert(`Start failed: ${err.message || err}`);
      stopStreaming();
    }
  }

  async function startLocalMedia() {
    const quality = parseInt($("res").value, 10);
    const fps = parseInt($("fps").value, 10);
    const selectedCam = $("camera-select").value;
    const selectedMic = $("audio-source").value;
    const startUnmuted = $("audio-enable").value === "true";

    let audioConstraints = true;
    if (selectedMic) audioConstraints = { deviceId: { exact: selectedMic } };

    const capture = await captureCameraStream({
      quality,
      fps,
      deviceId: selectedCam,
      audio: audioConstraints
    });
    state.myStream = capture.stream;

    state.videoTrack = state.myStream.getVideoTracks()[0] || null;
    state.audioTrack = state.myStream.getAudioTracks()[0] || null;
    applyTrackTuning(state.videoTrack, fps);
    if (state.audioTrack) state.audioTrack.enabled = startUnmuted;

    $("preview").srcObject = state.myStream;
    updateMicButton();
    updateLiveResDisplay();
    checkZoomCapabilities();
  }

  async function captureCameraStream({ quality, fps, deviceId, audio }) {
    let lastError = null;

    for (const attempt of buildCameraAttempts(quality, fps)) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: buildVideoConstraints(attempt.quality, fps, deviceId, attempt.fpsMode),
          audio
        });

        const track = stream.getVideoTracks()[0];
        const actualFps = track && track.getSettings ? Number(track.getSettings().frameRate || 0) : 0;
        const strictEnough = attempt.fpsMode !== "exact" || fps < 50 || !actualFps || actualFps >= fps - 5;

        if (strictEnough) return { stream, quality: attempt.quality, fpsMode: attempt.fpsMode };

        stream.getTracks().forEach((item) => item.stop());
        lastError = new Error(`Camera returned ${actualFps}fps instead of ${fps}fps`);
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error("Camera capture failed");
  }

  function buildCameraAttempts(quality, fps) {
    if (fps < 50) return [{ quality, fpsMode: "normal" }];

    const mode = getPerformanceMode();
    const fpsFirstOrder = [quality > 720 ? 720 : quality, 480, quality]
      .filter((value, index, list) => value <= quality && list.indexOf(value) === index);
    const qualityFirstOrder = [quality]
      .filter((value, index, list) => value <= quality && list.indexOf(value) === index);
    const qualityOrder = mode === "fps" ? fpsFirstOrder : qualityFirstOrder;

    return [
      ...qualityOrder.map((value) => ({ quality: value, fpsMode: "exact" })),
      { quality, fpsMode: "minimum" },
      { quality, fpsMode: "soft" }
    ];
  }

  function buildVideoConstraints(quality, fps, deviceId, fpsMode) {
    const constraints = {
      width: { ideal: Math.round(quality * 16 / 9) },
      height: { ideal: quality },
      frameRate: buildFrameRateConstraint(fps, fpsMode)
    };

    if (deviceId) {
      constraints.deviceId = { exact: deviceId };
    } else {
      constraints.facingMode = { ideal: "environment" };
    }

    return constraints;
  }

  function buildFrameRateConstraint(fps, fpsMode) {
    if (fps >= 50 && fpsMode === "exact") return { exact: fps };
    if (fps >= 50 && fpsMode === "minimum") return { ideal: fps, min: fps - 10 };
    if (fps >= 50 && fpsMode === "soft") return { ideal: fps };
    return { ideal: fps, min: 24 };
  }

  function applyTrackTuning(track, fps = getTargetFps()) {
    if (!track) return;
    try {
      track.contentHint = fps >= 50 ? "motion" : "detail";
    } catch {}
  }

  function syncLiveSelectors() {
    $("live-res").value = $("res").value;
    $("live-fps").value = $("fps").value;

    const bitrate = $("bitrate").value === "custom" ? String(state.customBitrate) : $("bitrate").value;
    addCustomBitrateOption($("live-bitrate"), bitrate);
    $("live-bitrate").value = bitrate;
  }

  function connectControl() {
    if (!state.peer || !state.peer.open || !state.roomId) return;
    if (state.controlConn && state.controlConn.open) return;

    const conn = state.peer.connect(controlId(state.roomId), {
      metadata: { role: "phone", cam: state.targetCam }
    });
    state.controlConn = conn;

    conn.on("open", () => {
      sendControl({ type: "hello", cam: state.targetCam, brand: BRAND });
    });
    conn.on("data", handleControlMessage);
    conn.on("close", () => {});
    conn.on("error", () => {});
  }

  function handleControlMessage(message) {
    const data = normalizeMessage(message);
    if (data.type === "config") {
      applyControlConfig(data);
    } else if (data.type === "reset-stats") {
      state.sessionTotalBytes = 0;
      state.lastBytes = 0;
      state.lastTime = Date.now();
    } else if (data.type === "reconnect") {
      reconnectSignaling();
    }
  }

  function applyControlConfig(config) {
    if (config.roomName) {
      $("live-room-name").classList.remove("hidden");
      setText("live-room-name", config.roomName);
      $("setup-room-name").classList.add("active");
      setText("setup-room-name-text", config.roomName);
    }

    const max = Math.min(8, Math.max(1, parseInt(config.maxCams || "8", 10)));
    const select = $("cam-index");
    const current = select.value;
    select.innerHTML = "";
    for (let i = 1; i <= max; i += 1) {
      select.add(new Option(`CAMERA ${i}`, String(i)));
    }
    select.value = parseInt(current, 10) <= max ? current : "1";
  }

  function connectOBS() {
    if (!state.peer || !state.peer.open || !state.myStream) return;

    if (state.mediaCall) {
      state.mediaCall.close();
      state.mediaCall = null;
    }

    state.mediaConnected = false;
    setStatus("WAITING OBS...", "#facc15");

    try {
      const call = state.peer.call(screenId(state.roomId, state.targetCam), state.myStream, {
        metadata: { role: "phone", cam: state.targetCam }
      });

      state.mediaCall = call;
      if (!call) {
        setStatus("WAITING OBS...", "#facc15");
        return;
      }

      call.on("stream", () => {});
      call.on("close", () => {
        state.mediaConnected = false;
        setStatus("WAITING OBS...", "#facc15");
      });
      call.on("error", () => {
        state.mediaConnected = false;
        setStatus("WAITING OBS...", "#facc15");
      });

      attachPeerConnectionState(call);
      setBitrate(getTargetBitrate() * 1000);
    } catch (err) {
      console.warn("[PEPSCam call]", err);
      setStatus("WAITING OBS...", "#facc15");
    }
  }

  function attachPeerConnectionState(call) {
    setTimeout(() => {
      const pc = call && call.peerConnection;
      if (!pc) return;

      const sync = () => {
        const connected = pc.connectionState === "connected" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed";
        state.mediaConnected = connected;
        if (connected) {
          setStatus(`LIVE : CAM ${state.targetCam}`, "#ef4444");
        } else if (pc.connectionState === "failed" || pc.iceConnectionState === "failed") {
          setStatus("RECONNECTING...", "#facc15");
        }
      };

      pc.addEventListener("connectionstatechange", sync);
      pc.addEventListener("iceconnectionstatechange", sync);
      sync();
    }, 250);
  }

  function startReconnectLoop() {
    clearInterval(state.reconnectTimer);
    state.reconnectTimer = setInterval(() => {
      if (!state.myStream || !state.peer || !state.peer.open) return;
      if (!state.controlConn || !state.controlConn.open) connectControl();
      if (!state.mediaConnected) connectOBS();
    }, 5000);
  }

  function normalizeMessage(message) {
    if (typeof message === "string") {
      try {
        return JSON.parse(message);
      } catch {
        return { type: message };
      }
    }
    return message || {};
  }

  function sendControl(payload) {
    try {
      if (state.controlConn && state.controlConn.open) state.controlConn.send(payload);
    } catch (err) {
      console.debug("[PEPSCam] control send failed", err);
    }
  }

  function getTargetBitrate() {
    return parseInt($("live-bitrate").value || $("bitrate").value || "2500", 10) || 2500;
  }

  function getTargetFps() {
    return parseInt($("live-fps").value || $("fps").value || "30", 10) || 30;
  }

  function getPerformanceMode() {
    const select = $("performance-mode");
    return select ? select.value : "fps";
  }

  function getDegradationPreference() {
    return getTargetFps() >= 50 && getPerformanceMode() === "fps"
      ? "maintain-framerate"
      : "maintain-resolution";
  }

  function setBitrate(bitrate) {
    const pc = state.mediaCall && state.mediaCall.peerConnection;
    if (!pc) return;

    const sender = pc.getSenders().find((item) => item.track && item.track.kind === "video");
    if (!sender || !sender.getParameters) return;

    const params = sender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    params.encodings[0].maxBitrate = bitrate;
    params.encodings[0].minBitrate = Math.floor(bitrate * 0.45);
    params.encodings[0].maxFramerate = getTargetFps();
    params.degradationPreference = getDegradationPreference();
    sender.setParameters(params).catch((err) => console.debug("setBitrate failed", err));
  }

  function startUpdatingStats() {
    clearInterval(state.statsTimer);
    state.lastBytes = 0;
    state.lastTime = Date.now();
    state.sessionTotalBytes = 0;

    state.statsTimer = setInterval(async () => {
      let bytes = 0;
      const pc = state.mediaCall && state.mediaCall.peerConnection;

      if (pc) {
        try {
          const stats = await pc.getStats();
          stats.forEach((report) => {
            if (report.type === "outbound-rtp" && (report.kind === "video" || report.mediaType === "video")) {
              bytes += report.bytesSent || 0;
            }
          });
        } catch (err) {
          console.debug("stats failed", err);
        }
      }

      const now = Date.now();
      const diffMs = now - state.lastTime;
      let kbps = 0;

      if (diffMs > 0 && bytes >= state.lastBytes) {
        const diff = bytes - state.lastBytes;
        kbps = Math.round((diff * 8) / diffMs);
        state.sessionTotalBytes += diff;
      }

      state.lastBytes = bytes;
      state.lastTime = now;

      setText("realtime-bw", `${kbps} kbps`);
      updateLiveResDisplay();

      const battery = await readBattery();
      if (battery !== null) $("battery-stat").innerHTML = `<i class="fa-solid fa-bolt"></i> ${battery}%`;

      const settings = state.videoTrack ? state.videoTrack.getSettings() : {};
      const payload = {
        type: "stats",
        cam: state.targetCam,
        r: `${settings.height || $("live-res").value}p`,
        f: Math.round(settings.frameRate || parseInt($("live-fps").value, 10) || 0),
        k: kbps,
        b: battery === null ? "--" : battery,
        d: (state.sessionTotalBytes / (1024 * 1024)).toFixed(1)
      };

      sendControl(payload);
    }, 1000);
  }

  async function readBattery() {
    try {
      if (!navigator.getBattery) return null;
      const battery = await navigator.getBattery();
      return Math.round(battery.level * 100);
    } catch {
      return null;
    }
  }

  function updateLiveResDisplay() {
    if (!state.videoTrack) return;
    const settings = state.videoTrack.getSettings();
    const width = settings.width || 0;
    const height = settings.height || 0;
    const fps = Math.round(settings.frameRate || 0);
    setText("live-res-text", `${width} x ${height} ${fps}fps`);
  }

  async function checkZoomCapabilities() {
    if (!state.videoTrack || !state.videoTrack.getCapabilities) return;
    const capabilities = state.videoTrack.getCapabilities();
    const slider = $("zoom-slider");
    if (capabilities.zoom) {
      slider.min = capabilities.zoom.min;
      slider.max = capabilities.zoom.max;
      slider.step = capabilities.zoom.step || 0.1;
      slider.value = capabilities.zoom.min;
      $("zoom-container").classList.remove("hidden");
    } else {
      $("zoom-container").classList.add("hidden");
    }
  }

  async function applyZoom(value) {
    if (!state.videoTrack) return;
    try {
      await state.videoTrack.applyConstraints({ advanced: [{ zoom: Number(value) }] });
    } catch (err) {
      console.debug("zoom failed", err);
    }
  }

  function updateLiveBitrate(value) {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      state.customBitrate = parsed;
      localStorage.setItem(STORAGE.bitrate, String(parsed));
      setBitrate(parsed * 1000);
    }
  }

  function applyLiveSettings() {
    $("res").value = $("live-res").value;
    $("fps").value = $("live-fps").value;
    saveSettings();
    switchCamera($("live-cam-select").value || undefined, parseInt($("live-res").value, 10), parseInt($("live-fps").value, 10));
  }

  async function switchCamera(deviceId, forceRes, forceFps) {
    if (!state.myStream) return;

    const quality = forceRes || parseInt($("live-res").value, 10);
    const fps = forceFps || parseInt($("live-fps").value, 10);
    const currentDeviceId = state.videoTrack && state.videoTrack.getSettings().deviceId;
    const targetDeviceId = deviceId || currentDeviceId || "";

    try {
      if (state.videoTrack) state.videoTrack.stop();
      const capture = await captureCameraStream({
        quality,
        fps,
        deviceId: targetDeviceId,
        audio: false
      });

      const newTrack = capture.stream.getVideoTracks()[0];
      applyTrackTuning(newTrack, fps);
      replaceTrack("video", newTrack);
      state.videoTrack = newTrack;
      rebuildMediaStream();
      $("preview").srcObject = state.myStream;
      setBitrate(getTargetBitrate() * 1000);
      checkZoomCapabilities();
      updateLiveResDisplay();

      if (deviceId) {
        $("camera-select").value = deviceId;
        $("live-cam-select").value = "";
      }
      saveSettings();
    } catch (err) {
      alert(`Switch/Apply Settings failed: ${err.message || err}`);
    }
  }

  async function switchMic(deviceId) {
    if (!state.myStream) return;

    try {
      if (state.audioTrack) state.audioTrack.stop();
      const audioConstraints = deviceId ? { deviceId: { exact: deviceId } } : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
      const newTrack = stream.getAudioTracks()[0];
      replaceTrack("audio", newTrack);
      state.audioTrack = newTrack;
      updateMicButton();
      rebuildMediaStream();
      $("preview").srcObject = state.myStream;

      if (deviceId) {
        $("audio-source").value = deviceId;
        $("live-mic-select").value = "";
      }
      saveSettings();
    } catch (err) {
      alert(`Switch Mic failed: ${err.message || err}`);
    }
  }

  function replaceTrack(kind, track) {
    const pc = state.mediaCall && state.mediaCall.peerConnection;
    if (!pc || !track) return;
    const sender = pc.getSenders().find((item) => item.track && item.track.kind === kind);
    if (sender) sender.replaceTrack(track).catch((err) => console.debug("replaceTrack failed", err));
  }

  function rebuildMediaStream() {
    const tracks = [];
    if (state.videoTrack) tracks.push(state.videoTrack);
    if (state.audioTrack) tracks.push(state.audioTrack);
    state.myStream = new MediaStream(tracks);
  }

  function toggleMic() {
    if (!state.audioTrack) return;
    state.audioTrack.enabled = !state.audioTrack.enabled;
    updateMicButton();
  }

  function updateMicButton() {
    const button = $("mic-btn");
    if (!button || !state.audioTrack) return;
    button.classList.toggle("green", state.audioTrack.enabled);
    button.classList.toggle("red", !state.audioTrack.enabled);
    button.innerHTML = state.audioTrack.enabled
      ? '<i class="fa-solid fa-microphone"></i>'
      : '<i class="fa-solid fa-microphone-slash"></i>';
  }

  function toggleFullScreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }

  function toggleUI(event) {
    if (event.target.closest("button") || event.target.closest("select") || event.target.closest("input")) return;
    $("overlay-controls").classList.toggle("ui-hidden");
  }

  function rotateUI() {
    state.isUIRotated = !state.isUIRotated;
    $("overlay-controls").classList.toggle("ui-rotate-90", state.isUIRotated);
  }

  async function toggleTorch() {
    if (!state.videoTrack) return;
    try {
      const current = Boolean(state.videoTrack.getSettings().torch);
      await state.videoTrack.applyConstraints({ advanced: [{ torch: !current }] });
      $("torch-btn").style.background = !current ? "rgba(234,179,8,.86)" : "rgba(0,0,0,.45)";
    } catch (err) {
      console.debug("torch not supported", err);
    }
  }

  async function triggerAutoFocus() {
    if (!state.videoTrack) return;
    try {
      await state.videoTrack.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
    } catch (err) {
      console.debug("focus not supported", err);
    }
  }

  function toggleGrid() {
    $("grid-layer").classList.toggle("hidden");
  }

  function reconnectSignaling() {
    if (!state.myStream) return;
    if (state.mediaCall) state.mediaCall.close();
    if (state.controlConn) state.controlConn.close();
    state.mediaConnected = false;
    setStatus("RECONNECTING...", "#facc15");
    setTimeout(() => {
      connectControl();
      connectOBS();
    }, 500);
  }

  function stopStreaming() {
    clearInterval(state.reconnectTimer);
    clearInterval(state.statsTimer);

    if (state.mediaCall) state.mediaCall.close();
    if (state.controlConn) state.controlConn.close();
    if (state.peer && !state.peer.destroyed) state.peer.destroy();
    if (state.myStream) state.myStream.getTracks().forEach((track) => track.stop());

    state.peer = null;
    state.mediaCall = null;
    state.controlConn = null;
    state.myStream = null;
    state.videoTrack = null;
    state.audioTrack = null;
    state.mediaConnected = false;
    state.sessionTotalBytes = 0;

    $("live-ui").classList.add("hidden");
    $("setup").classList.remove("hidden");
  }

  async function startQRScanner() {
    if (!navigator.mediaDevices || !window.jsQR) {
      alert("อุปกรณ์นี้ไม่รองรับ QR Scanner");
      return;
    }

    $("qr-overlay").classList.remove("hidden");
    const video = $("qr-video");
    const canvas = $("qr-canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    try {
      state.qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      video.srcObject = state.qrStream;
      await video.play();
      requestAnimationFrame(tick);
    } catch (err) {
      alert(`QR camera failed: ${err.message || err}`);
      stopQRScanner();
    }

    function tick() {
      if ($("qr-overlay").classList.contains("hidden")) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        if (code && code.data) {
          const parsed = parseRoomFromQR(code.data);
          if (parsed) {
            $("room-id").value = parsed;
            stopQRScanner();
            checkRoomConfig();
            return;
          }
        }
      }
      requestAnimationFrame(tick);
    }
  }

  function parseRoomFromQR(text) {
    try {
      const url = new URL(text);
      const room = cleanRoom(url.searchParams.get("room"));
      if (room.length === 6) return room;
    } catch {
      // Raw room code fallback below.
    }
    const match = String(text).match(/\b(\d{6})\b/);
    return match ? match[1] : "";
  }

  function stopQRScanner() {
    $("qr-overlay").classList.add("hidden");
    if (state.qrStream) state.qrStream.getTracks().forEach((track) => track.stop());
    state.qrStream = null;
  }

  function bootstrap() {
    loadSettings();

    const params = new URLSearchParams(window.location.search);
    const room = cleanRoom(params.get("room"));
    if (room) {
      $("room-id").value = room;
      checkRoomConfig();
    }

    initDeviceSelection();
  }

  window.PEPSCamPhone = {
    toggleSettingsModal,
    checkCustomBitrate,
    checkRoomConfig,
    startStreaming,
    stopStreaming,
    toggleMic,
    toggleFullScreen,
    toggleUI,
    updateLiveBitrate,
    applyLiveSettings,
    switchCamera,
    switchMic,
    applyZoom,
    rotateUI,
    toggleTorch,
    triggerAutoFocus,
    toggleGrid,
    reconnectSignaling,
    startQRScanner,
    stopQRScanner
  };

  bootstrap();
})();
