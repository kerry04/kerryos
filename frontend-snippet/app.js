/* KerryOS frontend snippet — session lifecycle logic.
 * API base is same-origin; Caddy proxies /api/* to the session broker.
 * No external requests, no build step. */
(function () {
  "use strict";

  var API = "/api";
  var HEARTBEAT_MS = 60 * 1000;
  var BOOT_OVERLAY_MS = 2600;

  var state = {
    sessionId: null,
    sessionToken: null,
    expiresAt: null,
    tickTimer: null,      // 1s countdown
    heartbeatTimer: null, // 60s heartbeat
    busyTimer: null       // busy-screen countdown
  };

  /* ---------- screen plumbing ---------- */

  var screens = ["idle", "starting", "boot", "session", "busy", "rate", "error", "expired"];

  function show(name) {
    screens.forEach(function (s) {
      document.getElementById("screen-" + s).classList.toggle("visible", s === name);
    });
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? "0" + m : "" + m) + ":" + (s < 10 ? "0" + s : "" + s);
  }

  function clearTimers() {
    ["tickTimer", "heartbeatTimer", "busyTimer"].forEach(function (k) {
      if (state[k]) { clearInterval(state[k]); state[k] = null; }
    });
  }

  /* ---------- api helpers ---------- */

  function authHeaders() {
    return {
      "Authorization": "Bearer " + state.sessionToken,
      "Content-Type": "application/json"
    };
  }

  function bootSession() {
    clearTimers();
    state.sessionId = null;
    state.sessionToken = null;
    state.expiresAt = null;
    show("starting");

    fetch(API + "/session", { method: "POST" })
      .then(function (res) {
        if (res.status === 200) return res.json().then(function (body) { return { ok: true, body: body }; });
        if (res.status === 409) return res.json().then(function (body) { return { busy: true, body: body }; });
        if (res.status === 429) return { rate: true };
        return res.text().then(function (t) {
          var msg = t;
          try { msg = JSON.parse(t).error || JSON.parse(t).message || t; } catch (e) {}
          return { err: true, msg: msg || ("HTTP " + res.status), status: res.status };
        });
      })
      .then(function (r) {
        if (r.ok) return startBootOverlay(r.body);
        if (r.busy) return showBusy(r.body.retry_after);
        if (r.rate) return show("rate");
        showError(r.msg);
      })
      .catch(function (e) {
        showError("Could not reach the server: " + (e && e.message ? e.message : e));
      });
  }

  /* ---------- 200 path ---------- */

  function startBootOverlay(body) {
    state.sessionId = body.session_id;
    state.sessionToken = body.session_token;
    state.expiresAt = body.expires_at;
    state.guacUrl = body.guac_url;
    show("boot");
    setTimeout(enterSession, BOOT_OVERLAY_MS);
  }

  function enterSession() {
    show("session");
    document.getElementById("guac-frame").src = state.guacUrl;
    startCountdown();
    state.heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
  }

  function remainingSec() {
    return (new Date(state.expiresAt).getTime() - Date.now()) / 1000;
  }

  function startCountdown() {
    var el = document.getElementById("countdown");
    function update() {
      var left = remainingSec();
      if (left <= 0) { expireSession(); return; }
      el.textContent = fmt(left);
      el.classList.toggle("low", left < 120);
    }
    update();
    state.tickTimer = setInterval(update, 1000);
  }

  function sendHeartbeat() {
    fetch(API + "/session/" + encodeURIComponent(state.sessionId) + "/heartbeat", {
      method: "POST",
      headers: authHeaders()
    })
      .then(function (res) {
        if (!res.ok) { expireSession(); return; }
        return res.json().then(function (body) {
          // Broker may extend or confirm expiry; trust its expires_at.
          if (body && body.expires_at) state.expiresAt = body.expires_at;
        }).catch(function () {});
      })
      .catch(function () { expireSession(); });
  }

  function expireSession() {
    endLocal("expired");
  }

  /* ---------- end session ---------- */

  function endSessionRemote() {
    var btn = document.getElementById("btn-end");
    btn.disabled = true;
    fetch(API + "/session/" + encodeURIComponent(state.sessionId), {
      method: "DELETE",
      headers: authHeaders()
    })
      .catch(function () {})
      .finally(function () {
        btn.disabled = false;
        endLocal("idle");
      });
  }

  function endLocal(screen) {
    clearTimers();
    var frame = document.getElementById("guac-frame");
    frame.src = "about:blank";
    state.sessionId = null;
    state.sessionToken = null;
    state.expiresAt = null;
    show(screen);
  }

  /* ---------- 409 path ---------- */

  function showBusy(retryAfter) {
    clearTimers();
    show("busy");
    var el = document.getElementById("busy-countdown");
    var btn = document.getElementById("btn-retry-busy");
    var left = Math.max(1, parseInt(retryAfter, 10) || 60);

    function update() {
      el.textContent = fmt(left);
      if (left <= 0) { clearInterval(state.busyTimer); state.busyTimer = null; bootSession(); return; }
      left -= 1;
    }
    btn.textContent = "Try now";
    btn.onclick = function () { bootSession(); };
    update();
    state.busyTimer = setInterval(update, 1000);
  }

  /* ---------- error ---------- */

  function showError(msg) {
    document.getElementById("error-message").textContent = String(msg);
    show("error");
  }

  /* ---------- wiring ---------- */

  document.getElementById("btn-boot").addEventListener("click", bootSession);
  document.getElementById("btn-boot-again").addEventListener("click", bootSession);
  document.getElementById("btn-retry-error").addEventListener("click", bootSession);
  document.getElementById("btn-back-rate").addEventListener("click", function () { show("idle"); });
  document.getElementById("btn-end").addEventListener("click", endSessionRemote);

  // If the user navigates away mid-session, release the machine.
  window.addEventListener("pagehide", function () {
    if (state.sessionId && state.sessionToken) {
      try {
        fetch(API + "/session/" + encodeURIComponent(state.sessionId), {
          method: "DELETE",
          headers: authHeaders(),
          keepalive: true
        });
      } catch (e) {}
    }
    clearTimers();
  });
})();
