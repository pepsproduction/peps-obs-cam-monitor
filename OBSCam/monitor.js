(function () {
  "use strict";

  const BRAND = "PEPSCam";
  const OWNER = "PEPS";
  const VERSION = "2.5b";
  const PEER_PREFIX = "pepscam-v1";
  const STORAGE_ROOM = "pepscam_room_id";
  const STORAGE_ROOM_NAME = "pepscam_room_name";
  const STORAGE_MAX_CAMS = "pepscam_max_cams";
  const STORAGE_BUFFER_SECONDS = "pepscam_buffer_seconds";

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
    roomName: "",
    maxCams: 4,
    bufferSeconds: 0,
    controlPeer: null,
    phoneConnections: new Map(),
    sourceConnections: new Map(),
    stats: new Map(),
    dataOffsets: new Map(),
    staleTimer: null,
    screenPeer: null,
    screenCall: null,
    screenControlConn: null,
    screenBufferSeconds: 0,
    currentScreenStream: null,
    bufferRecorder: null,
    bufferMediaSource: null,
    bufferSourceBuffer: null,
    bufferObjectUrl: "",
    bufferQueue: [],
    bufferRelayStarted: false,
    bufferRelayTimer: null,
    bufferRequestTimer: null,
    bufferFallbackTimer: null
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

  function randomRoomId() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function cleanRoom(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 6);
  }

  function showOnly(id) {
    ["start-screen", "connecting-screen", "mode-control", "mode-screen"].forEach((screenIdValue) => {
      const node = $(screenIdValue);
      if (node) node.classList.toggle("hidden", screenIdValue !== id);
    });
  }

  function setText(id, text) {
    const node = $(id);
    if (node) node.textContent = text;
  }

  function setConnectStatus(text) {
    setText("connect-status", text);
  }

  function setStepStatus(id, status) {
    const node = $(id);
    if (!node) return;
    node.classList.remove("step-ok", "step-fail");
    if (status === "ok") {
      node.classList.add("step-ok");
      node.querySelector("i").className = "fa-solid fa-check";
    } else if (status === "fail") {
      node.classList.add("step-fail");
      node.querySelector("i").className = "fa-solid fa-xmark";
    } else {
      node.querySelector("i").className = "fa-solid fa-circle";
      node.querySelector("i").style.fontSize = "6px";
    }
  }

  function resetConnectingUI() {
    $("connect-spinner").classList.remove("hidden");
    $("connect-icon-success").classList.add("hidden");
    $("connect-icon-fail").classList.add("hidden");
    $("btn-retry").classList.add("hidden");
    ["step-signal", "step-room", "step-ready"].forEach((id) => setStepStatus(id, "idle"));
  }

  function connectionFailed(message) {
    setConnectStatus(message);
    setStepStatus("step-signal", "fail");
    $("connect-spinner").classList.add("hidden");
    $("connect-icon-fail").classList.remove("hidden");
    $("btn-retry").classList.remove("hidden");
  }

  function checkExistingSession() {
    const savedRoom = cleanRoom(localStorage.getItem(STORAGE_ROOM));
    if (savedRoom) {
      $("btn-start-fresh").classList.add("hidden");
      $("rejoin-area").classList.remove("hidden");
      setText("prev-room-id", savedRoom);
    } else {
      $("btn-start-fresh").classList.remove("hidden");
      $("rejoin-area").classList.add("hidden");
    }
    showOnly("start-screen");
  }

  function initializeControl(rejoin) {
    const savedRoom = cleanRoom(localStorage.getItem(STORAGE_ROOM));
    state.roomId = rejoin && savedRoom ? savedRoom : randomRoomId();
    state.roomName = localStorage.getItem(STORAGE_ROOM_NAME) || "";
    state.maxCams = clampMaxCams(parseInt(localStorage.getItem(STORAGE_MAX_CAMS) || "4", 10));
    state.bufferSeconds = clampBufferSeconds(localStorage.getItem(STORAGE_BUFFER_SECONDS));
    localStorage.setItem(STORAGE_ROOM, state.roomId);
    startConnectionProcess();
  }

  function clampMaxCams(value) {
    return Math.min(8, Math.max(1, Number.isFinite(value) ? value : 4));
  }

  function clampBufferSeconds(value) {
    const seconds = parseInt(value || "0", 10);
    if (!Number.isFinite(seconds)) return 0;
    return Math.min(10, Math.max(0, seconds));
  }

  async function startConnectionProcess() {
    showOnly("connecting-screen");
    resetConnectingUI();
    setText("connecting-room-id", state.roomId);
    setConnectStatus("กำลังเชื่อมต่อ Signaling...");

    if (!window.Peer) {
      connectionFailed("โหลด PeerJS ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่");
      return;
    }

    try {
      if (state.controlPeer && !state.controlPeer.destroyed) state.controlPeer.destroy();
      state.controlPeer = new Peer(controlId(state.roomId), peerOptions());

      state.controlPeer.on("connection", handleControlConnection);
      state.controlPeer.on("error", (err) => {
        const unavailable = err && err.type === "unavailable-id";
        connectionFailed(unavailable ? "Room นี้เปิดอยู่ในแท็บอื่นแล้ว" : `Signaling Error: ${err.message || err.type || err}`);
      });

      await waitForPeerOpen(state.controlPeer, 12000);
      setStepStatus("step-signal", "ok");
      setConnectStatus("สร้างห้องเรียบร้อย...");
      await delay(250);
      setStepStatus("step-room", "ok");
      await delay(250);
      setStepStatus("step-ready", "ok");
      $("connect-spinner").classList.add("hidden");
      $("connect-icon-success").classList.remove("hidden");
      setConnectStatus("พร้อมใช้งาน");
      await delay(450);
      showControlPanel();
    } catch (err) {
      connectionFailed(err.message || "เชื่อมต่อ Signaling ไม่สำเร็จ");
    }
  }

  function waitForPeerOpen(peer, timeout) {
    return new Promise((resolve, reject) => {
      if (peer.open) {
        resolve(peer.id);
        return;
      }
      const timer = setTimeout(() => reject(new Error("Signaling timeout")), timeout);
      peer.once("open", (id) => {
        clearTimeout(timer);
        resolve(id);
      });
      peer.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function showControlPanel() {
    setText("display-room-id", state.roomId);
    $("max-cams-select").value = String(state.maxCams);
    $("buffer-select").value = String(state.bufferSeconds);
    updateRoomNameDisplay(state.roomName);
    renderCamList();
    updatePhoneLink();
    showOnly("mode-control");
    sendConfigToAll();

    clearInterval(state.staleTimer);
    state.staleTimer = setInterval(markStaleConnections, 2500);
  }

  function renderCamList() {
    const list = $("cam-list");
    list.innerHTML = "";

    for (let cam = 1; cam <= state.maxCams; cam += 1) {
      const row = document.createElement("div");
      row.className = "cam-row";
      row.innerHTML = `
        <div>
          <span class="cam-name">CAMERA ${cam}</span>
          <div class="cam-meta">
            <span id="info-res-${cam}">WAITING</span>
            <span id="info-data-${cam}">0.0 MB</span>
            <span id="info-bw-${cam}">0 kbps</span>
            <span id="bat-${cam}"><i class="fa-solid fa-bolt"></i> --%</span>
          </div>
        </div>
        <div class="cam-actions">
          <span id="badge-phone-${cam}" class="status-badge badge-off"><i class="fa-solid fa-mobile-screen"></i> OFF</span>
          <span id="badge-obs-${cam}" class="status-badge badge-off"><i class="fa-solid fa-desktop"></i> OFF</span>
          <button class="status-badge badge-off" title="Reset Source" onclick="PEPSCamMonitor.resetSource(${cam})"><i class="fa-solid fa-rotate"></i></button>
        </div>
      `;
      list.appendChild(row);
    }

    state.stats.forEach((stats, cam) => updateStatsUI(cam, stats));
    state.phoneConnections.forEach((conn, cam) => {
      if (conn && conn.open) setPhoneStatus(cam, "live");
    });
    state.sourceConnections.forEach((conn, cam) => {
      if (conn && conn.open) setSourceStatus(cam, "ready");
    });
    calculateTotalData();
  }

  function handleControlConnection(conn) {
    const role = (conn.metadata && conn.metadata.role) || "phone";
    const cam = String(clampMaxCams(parseInt((conn.metadata && conn.metadata.cam) || "1", 10)));

    conn.on("open", () => {
      conn._lastSeen = Date.now();
      if (role === "screen") {
        state.sourceConnections.set(cam, conn);
        setSourceStatus(cam, "ready");
      } else {
        state.phoneConnections.set(cam, conn);
        setPhoneStatus(cam, "live");
      }
      safeSend(conn, {
        type: "config",
        brand: BRAND,
        owner: OWNER,
        version: VERSION,
        roomId: state.roomId,
        roomName: state.roomName,
        maxCams: state.maxCams,
        bufferSeconds: state.bufferSeconds
      });
    });

    conn.on("data", (message) => {
      const data = normalizeMessage(message);
      conn._lastSeen = Date.now();
      const targetCam = String(data.cam || cam);

      if (data.type === "stats") {
        state.stats.set(targetCam, data);
        updateStatsUI(targetCam, data);
        setPhoneStatus(targetCam, "live");
      } else if (data.type === "source-ready") {
        setSourceStatus(targetCam, "ready");
      } else if (data.type === "source-sleep") {
        setSourceStatus(targetCam, "sleep");
      } else if (data.type === "hello") {
        if (role === "screen") setSourceStatus(targetCam, "ready");
        else setPhoneStatus(targetCam, "live");
      }
    });

    conn.on("close", () => {
      if (role === "screen") {
        if (state.sourceConnections.get(cam) === conn) state.sourceConnections.delete(cam);
        setSourceStatus(cam, "off");
      } else {
        if (state.phoneConnections.get(cam) === conn) state.phoneConnections.delete(cam);
        setPhoneStatus(cam, "off");
      }
    });

    conn.on("error", () => {
      if (role === "screen") setSourceStatus(cam, "off");
      else setPhoneStatus(cam, "off");
    });
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

  function safeSend(conn, payload) {
    try {
      if (conn && conn.open) conn.send(payload);
    } catch (err) {
      console.debug("[PEPSCam] send failed", err);
    }
  }

  function setPhoneStatus(cam, status) {
    const badge = $(`badge-phone-${cam}`);
    if (!badge) return;
    if (status === "live") {
      badge.className = "status-badge badge-live";
      badge.innerHTML = '<i class="fa-solid fa-mobile-screen"></i> LIVE';
    } else if (status === "connecting") {
      badge.className = "status-badge badge-connecting";
      badge.innerHTML = '<i class="fa-solid fa-circle-notch spinner"></i> CONNECTING';
    } else {
      badge.className = "status-badge badge-off";
      badge.innerHTML = '<i class="fa-solid fa-mobile-screen"></i> OFF';
    }
  }

  function setSourceStatus(cam, status) {
    const badge = $(`badge-obs-${cam}`);
    if (!badge) return;
    if (status === "ready") {
      badge.className = "status-badge badge-ready";
      badge.innerHTML = '<i class="fa-solid fa-desktop"></i> READY';
    } else if (status === "sleep") {
      badge.className = "status-badge badge-sleep";
      badge.innerHTML = '<i class="fa-solid fa-moon"></i> SLEEP';
    } else {
      badge.className = "status-badge badge-off";
      badge.innerHTML = '<i class="fa-solid fa-desktop"></i> OFF';
    }
  }

  function updateStatsUI(cam, data) {
    if (parseInt(cam, 10) > state.maxCams) return;
    const offset = state.dataOffsets.get(String(cam)) || 0;
    const rawMb = parseFloat(data.d || data.mb || 0) || 0;
    const mb = Math.max(0, rawMb - offset);

    setText(`info-res-${cam}`, `${data.r || "--"} ${data.f || "--"}fps`);
    setText(`info-data-${cam}`, `${mb.toFixed(1)} MB`);
    setText(`info-bw-${cam}`, `${data.k || 0} kbps`);
    const bat = $(`bat-${cam}`);
    if (bat) bat.innerHTML = `<i class="fa-solid fa-bolt"></i> ${data.b || "--"}%`;
    calculateTotalData();
  }

  function markStaleConnections() {
    const now = Date.now();

    state.phoneConnections.forEach((conn, cam) => {
      if (!conn.open || now - (conn._lastSeen || 0) > 12000) {
        setPhoneStatus(cam, "off");
      }
    });

    state.sourceConnections.forEach((conn, cam) => {
      if (!conn.open || now - (conn._lastSeen || 0) > 12000) {
        setSourceStatus(cam, "off");
      }
    });
  }

  function changeMaxCams(value) {
    state.maxCams = clampMaxCams(parseInt(value, 10));
    localStorage.setItem(STORAGE_MAX_CAMS, String(state.maxCams));
    renderCamList();
    updatePhoneLink();
    sendConfigToAll();
  }

  function changeBufferSeconds(value) {
    state.bufferSeconds = clampBufferSeconds(value);
    localStorage.setItem(STORAGE_BUFFER_SECONDS, String(state.bufferSeconds));
    sendConfigToAll();
  }

  function sendConfigToAll() {
    const payload = {
      type: "config",
      brand: BRAND,
      owner: OWNER,
      version: VERSION,
      roomId: state.roomId,
      roomName: state.roomName,
      maxCams: state.maxCams,
      bufferSeconds: state.bufferSeconds
    };
    state.phoneConnections.forEach((conn) => safeSend(conn, payload));
    state.sourceConnections.forEach((conn) => safeSend(conn, payload));
  }

  function showRoomNameEdit() {
    $("room-name-display").classList.add("hidden");
    $("room-name-edit").classList.remove("hidden");
    $("room-name-input").focus();
  }

  function cancelRoomNameEdit() {
    $("room-name-input").value = state.roomName;
    $("room-name-edit").classList.add("hidden");
    $("room-name-display").classList.remove("hidden");
  }

  function confirmRoomName() {
    state.roomName = $("room-name-input").value.trim().slice(0, 30);
    localStorage.setItem(STORAGE_ROOM_NAME, state.roomName);
    updateRoomNameDisplay(state.roomName);
    $("room-name-edit").classList.add("hidden");
    $("room-name-display").classList.remove("hidden");
    sendConfigToAll();
  }

  function updateRoomNameDisplay(name) {
    const displayName = name || "ไม่มีชื่อห้อง";
    $("room-name-text").textContent = displayName;
    $("room-name-text").style.fontStyle = name ? "normal" : "italic";
    $("room-name-input").value = name || "";
  }

  function resetSource(cam) {
    const camKey = String(cam);
    safeSend(state.sourceConnections.get(camKey), { type: "reset", cam: camKey });
    safeSend(state.phoneConnections.get(camKey), { type: "reconnect", cam: camKey });
    setSourceStatus(camKey, "off");
    setPhoneStatus(camKey, "connecting");
  }

  function resetDataUsage() {
    for (let cam = 1; cam <= state.maxCams; cam += 1) {
      const key = String(cam);
      const stats = state.stats.get(key);
      state.dataOffsets.set(key, parseFloat(stats && (stats.d || stats.mb)) || 0);
      setText(`info-data-${cam}`, "0.0 MB");
      safeSend(state.phoneConnections.get(key), { type: "reset-stats", cam: key });
    }
    setText("val-total-data", "0.0 MB");
  }

  function calculateTotalData() {
    let total = 0;
    for (let cam = 1; cam <= state.maxCams; cam += 1) {
      const node = $(`info-data-${cam}`);
      if (node) total += parseFloat(node.textContent.replace(" MB", "")) || 0;
    }
    setText("val-total-data", `${total.toFixed(1)} MB`);
  }

  function phoneUrl() {
    const url = new URL("OBSCamPhone.html", window.location.href);
    url.searchParams.set("room", state.roomId);
    return url.toString();
  }

  function screenUrl(cam) {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("mode", "screen");
    url.searchParams.set("cam", String(cam));
    url.searchParams.set("room", state.roomId);
    url.searchParams.set("buffer", String(state.bufferSeconds));
    return url.toString();
  }

  async function updatePhoneLink() {
    const url = phoneUrl();
    $("phone-url-input").value = url;
    await renderPhoneQr(url);
  }

  async function renderPhoneQr(url) {
    const canvas = $("qr-code-canvas");
    const dom = $("qr-code-dom");
    if (!canvas || !dom) return;

    dom.innerHTML = "";
    dom.classList.add("hidden");
    canvas.classList.remove("hidden");
    clearQrCanvas(canvas);

    if (window.QRCode && typeof window.QRCode.toCanvas === "function") {
      try {
        await qrToCanvas(canvas, url);
        if (!isQrCanvasBlank(canvas)) return;
      } catch (err) {
        console.warn("[PEPSCam] QR canvas render failed", err);
      }
    }

    if (typeof window.QRCode === "function") {
      try {
        new window.QRCode(dom, {
          text: url,
          width: 132,
          height: 132,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 0
        });
        canvas.classList.add("hidden");
        dom.classList.remove("hidden");
        return;
      } catch (err) {
        console.warn("[PEPSCam] QR DOM render failed", err);
      }
    }

    drawQrFallback(canvas);
  }

  function qrToCanvas(canvas, url) {
    return new Promise((resolve, reject) => {
      window.QRCode.toCanvas(canvas, url, {
        width: 132,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" }
      }, (err) => err ? reject(err) : resolve());
    });
  }

  function clearQrCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function isQrCanvasBlank(canvas) {
    try {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80 && data[i + 3] > 0) return false;
      }
    } catch {
      return false;
    }
    return true;
  }

  function drawQrFallback(canvas) {
    const ctx = canvas.getContext("2d");
    clearQrCanvas(canvas);
    ctx.fillStyle = "#111827";
    ctx.font = "bold 12px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("QR ERROR", 66, 58);
    ctx.font = "10px Segoe UI, Arial, sans-serif";
    ctx.fillText("USE COPY", 66, 76);
  }

  function openLinkModal() {
    const container = $("links-container");
    container.innerHTML = "";

    for (let cam = 1; cam <= state.maxCams; cam += 1) {
      const row = document.createElement("div");
      row.className = "link-row";
      row.innerHTML = `
        <label>Camera ${cam}</label>
        <div class="link-controls">
          <div id="link-cam${cam}" class="link-text">${screenUrl(cam)}</div>
          <button class="btn-small" onclick="PEPSCamMonitor.copyToClip('link-cam${cam}')">Copy</button>
          <button class="btn-small" style="background:#16a34a" title="Add to OBS via WebSocket" onclick="PEPSCamMonitor.addToOBS(${cam}, this)">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>
      `;
      container.appendChild(row);
    }

    openModal("obs-link-modal");
  }

  async function addToOBS(cam, button) {
    const btn = button || event.target.closest("button");
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch spinner"></i>';
    btn.disabled = true;

    try {
      const OBSWebSocketCtor = window.OBSWebSocket && (window.OBSWebSocket.default || window.OBSWebSocket);
      if (!OBSWebSocketCtor) throw new Error("OBS WebSocket library not loaded");
      const obs = new OBSWebSocketCtor();
      await obs.connect("ws://localhost:4455");

      const scene = await obs.call("GetCurrentProgramScene");
      const sceneName = scene.currentProgramSceneName;
      const inputName = `${BRAND} ${cam}`;
      const url = $(`link-cam${cam}`).textContent;

      try {
        await obs.call("CreateInput", {
          sceneName,
          inputName,
          inputKind: "browser_source",
          inputSettings: { url, width: 1920, height: 1080 },
          sceneItemEnabled: true
        });
      } catch (err) {
        if (err && err.code === 601) {
          await obs.call("SetInputSettings", {
            inputName,
            inputSettings: { url, width: 1920, height: 1080 }
          });
        } else {
          throw err;
        }
      }

      btn.innerHTML = '<i class="fa-solid fa-check"></i>';
      await obs.disconnect();
    } catch (err) {
      console.error("[PEPSCam OBS]", err);
      btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      alert(
        "ไม่สามารถเชื่อมต่อ OBS WebSocket ได้\n\n" +
        "กรุณาเปิด WebSocket Server ใน OBS:\n" +
        "Tools -> WebSocket Server Settings\n" +
        "Port: 4455 | ไม่ใส่รหัส\n\n" +
        (err.message || "")
      );
    }

    setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.disabled = false;
    }, 1800);
  }

  function openNewRoomModal() {
    openModal("new-room-modal");
  }

  async function confirmNewRoom() {
    const button = $("confirm-new-room-btn");
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-circle-notch spinner"></i> Updating OBS...';

    const oldRoom = state.roomId;
    const newRoom = randomRoomId();
    await autoUpdateExistingSources(newRoom);

    localStorage.setItem(STORAGE_ROOM, newRoom);
    state.roomId = newRoom;
    if (state.controlPeer && !state.controlPeer.destroyed) {
      state.controlPeer.destroy();
    }
    if (oldRoom) console.log(`[PEPSCam] New room ${oldRoom} -> ${newRoom}`);
    location.href = new URL(window.location.pathname, window.location.origin).toString();
  }

  async function autoUpdateExistingSources(newRoom) {
    try {
      const OBSWebSocketCtor = window.OBSWebSocket && (window.OBSWebSocket.default || window.OBSWebSocket);
      if (!OBSWebSocketCtor) return;
      const obs = new OBSWebSocketCtor();
      await obs.connect("ws://localhost:4455");

      for (let cam = 1; cam <= state.maxCams; cam += 1) {
        const url = new URL(window.location.href);
        url.search = "";
        url.searchParams.set("mode", "screen");
        url.searchParams.set("cam", String(cam));
        url.searchParams.set("room", newRoom);
        url.searchParams.set("buffer", String(state.bufferSeconds));

        try {
          await obs.call("SetInputSettings", {
            inputName: `${BRAND} ${cam}`,
            inputSettings: { url: url.toString(), width: 1920, height: 1080 }
          });
        } catch {
          // Source does not exist yet.
        }
      }

      await obs.disconnect();
    } catch (err) {
      console.log("[PEPSCam OBS] Skip auto update", err);
    }
  }

  function openModal(id) {
    if (id === "phone-link-modal") updatePhoneLink();
    $(id).classList.add("active");
  }

  function closeModal(id) {
    $(id).classList.remove("active");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const input = document.createElement("textarea");
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
  }

  function copyToClip(id) {
    const node = $(id);
    if (node) copyText(node.textContent);
  }

  function copyPhoneLink() {
    copyText($("phone-url-input").value);
  }

  function retryConnection() {
    checkExistingSession();
  }

  function startScreenPlayback(stream) {
    const video = $("remote-video");
    document.body.dataset.bufferSeconds = String(state.screenBufferSeconds);
    stopBufferedRelay();
    applyReceiverJitterBuffer();

    if (state.screenBufferSeconds > 4 && startBufferedRelay(stream, state.screenBufferSeconds)) {
      document.body.dataset.bufferMode = "relay";
      return;
    }

    document.body.dataset.bufferMode = state.screenBufferSeconds > 0 ? "jitter" : "off";
    video.removeAttribute("src");
    video.srcObject = stream;
    video.play().catch(() => {});
  }

  function applyReceiverJitterBuffer() {
    const pc = state.screenCall && state.screenCall.peerConnection;
    if (!pc || !pc.getReceivers) return;

    const targetMs = Math.min(state.screenBufferSeconds * 1000, 4000);
    pc.getReceivers().forEach((receiver) => {
      if ("jitterBufferTarget" in receiver) {
        try {
          receiver.jitterBufferTarget = targetMs;
        } catch (err) {
          console.debug("[PEPSCam] jitterBufferTarget failed", err);
        }
      }
    });
  }

  function startBufferedRelay(stream, seconds) {
    if (!window.MediaRecorder || !window.MediaSource) return false;

    const video = $("remote-video");
    const mimeType = pickRelayMimeType();
    if (!mimeType) return false;

    try {
      const mediaSource = new MediaSource();
      const objectUrl = URL.createObjectURL(mediaSource);
      const recorder = new MediaRecorder(stream, { mimeType });

      state.bufferMediaSource = mediaSource;
      state.bufferRecorder = recorder;
      state.bufferObjectUrl = objectUrl;
      state.bufferQueue = [];
      state.bufferRelayStarted = false;

      video.srcObject = null;
      video.src = objectUrl;

      mediaSource.addEventListener("sourceopen", () => {
        try {
          state.bufferSourceBuffer = mediaSource.addSourceBuffer(mimeType);
          state.bufferSourceBuffer.mode = "sequence";
          state.bufferSourceBuffer.addEventListener("updateend", pumpRelayBuffer);
          pumpRelayBuffer();
        } catch (err) {
          console.warn("[PEPSCam] relay source buffer failed", err);
          stopBufferedRelay();
          video.srcObject = stream;
          video.play().catch(() => {});
        }
      }, { once: true });

      recorder.ondataavailable = (event) => {
        document.body.dataset.recorderState = recorder.state;
        if (!event.data || !event.data.size) return;
        clearTimeout(state.bufferFallbackTimer);
        state.bufferFallbackTimer = null;
        event.data.arrayBuffer().then((buffer) => {
          state.bufferQueue.push(buffer);
          document.body.dataset.bufferQueue = String(state.bufferQueue.length);
          pumpRelayBuffer();
        }).catch(() => {});
      };

      recorder.onerror = (event) => {
        console.warn("[PEPSCam] relay recorder failed", event && (event.error || event.name || event.type));
        stopBufferedRelay();
        video.srcObject = stream;
        video.play().catch(() => {});
      };
      recorder.onstart = () => {
        document.body.dataset.recorderState = recorder.state;
      };

      recorder.start(250);
      state.bufferRequestTimer = setInterval(() => {
        if (recorder.state === "recording") {
          try {
            recorder.requestData();
          } catch {}
        }
      }, 250);
      state.bufferRelayTimer = setTimeout(() => {
        state.bufferRelayStarted = true;
        video.play().catch(() => {});
        pumpRelayBuffer();
      }, seconds * 1000);
      state.bufferFallbackTimer = setTimeout(() => {
        if (!state.bufferQueue.length && video.readyState === 0) {
          console.warn("[PEPSCam] relay produced no chunks; falling back to receiver jitter buffer");
          stopBufferedRelay();
          document.body.dataset.bufferMode = "jitter";
          video.srcObject = stream;
          video.play().catch(() => {});
        }
      }, Math.max(2200, Math.min(seconds * 1000 + 1800, 5000)));

      return true;
    } catch (err) {
      console.warn("[PEPSCam] relay buffer unavailable", err);
      stopBufferedRelay();
      return false;
    }
  }

  function pickRelayMimeType() {
    const candidates = [
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8",
      "video/webm"
    ];

    return candidates.find((type) => {
      const recorderOk = MediaRecorder.isTypeSupported ? MediaRecorder.isTypeSupported(type) : true;
      const sourceOk = MediaSource.isTypeSupported ? MediaSource.isTypeSupported(type) : true;
      return recorderOk && sourceOk;
    }) || "";
  }

  function pumpRelayBuffer() {
    const sourceBuffer = state.bufferSourceBuffer;
    if (!state.bufferRelayStarted || !sourceBuffer || sourceBuffer.updating || !state.bufferQueue.length) return;

    try {
      sourceBuffer.appendBuffer(state.bufferQueue.shift());
      document.body.dataset.bufferQueue = String(state.bufferQueue.length);
      document.body.dataset.bufferedRanges = getBufferedRanges(sourceBuffer);
    } catch (err) {
      console.warn("[PEPSCam] relay append failed", err);
      state.bufferQueue.length = 0;
    }
  }

  function getBufferedRanges(sourceBuffer) {
    try {
      const ranges = [];
      for (let i = 0; i < sourceBuffer.buffered.length; i += 1) {
        ranges.push(`${sourceBuffer.buffered.start(i).toFixed(2)}-${sourceBuffer.buffered.end(i).toFixed(2)}`);
      }
      return ranges.join(",");
    } catch {
      return "";
    }
  }

  function stopBufferedRelay() {
    clearTimeout(state.bufferRelayTimer);
    clearTimeout(state.bufferFallbackTimer);
    clearInterval(state.bufferRequestTimer);
    state.bufferRelayTimer = null;
    state.bufferFallbackTimer = null;
    state.bufferRequestTimer = null;

    if (state.bufferRecorder && state.bufferRecorder.state !== "inactive") {
      try {
        state.bufferRecorder.stop();
      } catch {}
    }

    if (state.bufferObjectUrl) {
      URL.revokeObjectURL(state.bufferObjectUrl);
    }

    state.bufferRecorder = null;
    state.bufferMediaSource = null;
    state.bufferSourceBuffer = null;
    state.bufferObjectUrl = "";
    state.bufferQueue = [];
    state.bufferRelayStarted = false;
  }

  async function startScreenMode(room, cam, bufferSeconds) {
    state.roomId = cleanRoom(room);
    const camKey = String(clampMaxCams(parseInt(cam || "1", 10)));
    state.screenBufferSeconds = clampBufferSeconds(bufferSeconds);
    showOnly("mode-screen");

    if (!state.roomId) {
      setWaiting("Error: Room ID not found in URL.");
      return;
    }

    if (!window.Peer) {
      setWaiting("Error: PeerJS library not loaded.");
      return;
    }

    setWaiting(`OBS SOURCE READY: CAM ${camKey}`);
    state.screenPeer = new Peer(screenId(state.roomId, camKey), peerOptions());

    state.screenPeer.on("open", () => {
      setWaiting("WAITING FOR CAMERA...");
      connectScreenControl(camKey);
      setInterval(() => connectScreenControl(camKey), 5000);
    });

    state.screenPeer.on("call", (call) => {
      if (state.screenCall) state.screenCall.close();
      state.screenCall = call;
      setWaiting("CONNECTING...");
      call.answer();
      call.on("stream", (stream) => {
        state.currentScreenStream = stream;
        startScreenPlayback(stream);
        const label = state.screenBufferSeconds > 0 ? `BUFFER ${state.screenBufferSeconds}s` : "LIVE";
        setWaiting(`${label} : CONNECTING...`);
        const hideDelay = state.screenBufferSeconds > 4
          ? state.screenBufferSeconds * 1000 + 1000
          : Math.max(600, Math.min(state.screenBufferSeconds * 1000, 2500));
        setTimeout(() => $("waiting-screen").classList.add("hidden"), hideDelay);
        sendScreenMessage({ type: "source-ready", cam: camKey });
      });
      call.on("close", () => {
        stopBufferedRelay();
        state.currentScreenStream = null;
        $("remote-video").srcObject = null;
        setWaiting("WAITING FOR CAMERA...");
      });
      call.on("error", () => {
        stopBufferedRelay();
        state.currentScreenStream = null;
        $("remote-video").srcObject = null;
        setWaiting("WAITING FOR CAMERA...");
      });
    });

    state.screenPeer.on("error", (err) => {
      const message = err && err.type === "unavailable-id"
        ? "SOURCE ALREADY OPEN FOR THIS CAMERA"
        : `SOURCE ERROR: ${err.message || err.type || err}`;
      setWaiting(message);
    });

    function connectScreenControl(targetCam) {
      if (!state.screenPeer || !state.screenPeer.open) return;
      if (state.screenControlConn && state.screenControlConn.open) {
        sendScreenMessage({ type: "source-ready", cam: targetCam });
        return;
      }
      const conn = state.screenPeer.connect(controlId(state.roomId), {
        metadata: { role: "screen", cam: targetCam }
      });
      state.screenControlConn = conn;
      conn.on("open", () => sendScreenMessage({ type: "source-ready", cam: targetCam }));
      conn.on("data", (message) => {
        const data = normalizeMessage(message);
        if (data.type === "reset") {
          if (state.screenCall) state.screenCall.close();
          stopBufferedRelay();
          state.currentScreenStream = null;
          $("remote-video").srcObject = null;
          setWaiting("WAITING FOR CAMERA...");
        } else if (data.type === "config") {
          const nextBuffer = clampBufferSeconds(data.bufferSeconds);
          if (nextBuffer !== state.screenBufferSeconds) {
            state.screenBufferSeconds = nextBuffer;
            if (state.currentScreenStream) startScreenPlayback(state.currentScreenStream);
          }
        }
      });
      conn.on("close", () => {});
      conn.on("error", () => {});
    }
  }

  function sendScreenMessage(payload) {
    safeSend(state.screenControlConn, payload);
  }

  function setWaiting(text) {
    $("waiting-screen").classList.remove("hidden");
    setText("waiting-text", text);
  }

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");

  window.PEPSCamMonitor = {
    initializeControl,
    retryConnection,
    changeMaxCams,
    changeBufferSeconds,
    showRoomNameEdit,
    cancelRoomNameEdit,
    confirmRoomName,
    resetSource,
    resetDataUsage,
    openLinkModal,
    addToOBS,
    openNewRoomModal,
    confirmNewRoom,
    openModal,
    closeModal,
    copyToClip,
    copyPhoneLink
  };

  if (mode === "screen") {
    startScreenMode(params.get("room"), params.get("cam"), params.get("buffer"));
  } else {
    checkExistingSession();
  }
})();
