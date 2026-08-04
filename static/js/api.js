/* Tiny fetch wrapper around the FastAPI backend. */
(function () {
  // window.API_BASE is defined in static/js/config.js (empty string when the
  // frontend and API share an origin; a full https://... URL when the
  // frontend is deployed separately, e.g. on Vercel, hitting a Render API).
  const BASE = window.API_BASE || "";
  const TOKEN_KEY = "rms_token";
  function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
  function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }

  function withBase(path) {
    return /^https?:\/\//i.test(path) ? path : BASE + path;
  }

  async function request(path, options) {
    const config = Object.assign({ method: "GET", headers: {} }, options || {});
    config.credentials = BASE ? "include" : "same-origin";
    const token = getToken();
    if (token) config.headers["Authorization"] = "Bearer " + token;

    if (config.body !== undefined && typeof config.body !== "string") {
      config.headers["Content-Type"] = "application/json";
      config.body = JSON.stringify(config.body);
    }

    let response;
    try {
      response = await fetch(withBase(path), config);
    } catch (networkError) {
      throw new Error("Cannot reach the server. Is the Python app still running?");
    }

    if (response.status === 401 && !path.includes("/auth/login")) {
      setToken("");
      window.location.href = "/login";
      throw new Error("Session expired.");
    }

    let payload = null;
    const text = await response.text();
    if (text) {
      try { payload = JSON.parse(text); } catch (e) { payload = { detail: text }; }
    }

    if (!response.ok) {
      const detail = payload && payload.detail ? payload.detail : "Request failed (" + response.status + ")";
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return payload;
  }

  function query(params) {
    const search = new URLSearchParams();
    Object.keys(params || {}).forEach((key) => {
      const value = params[key];
      if (value !== undefined && value !== null && value !== "" && value !== "all") {
        search.append(key, value);
      }
    });
    const str = search.toString();
    return str ? "?" + str : "";
  }

  window.API = {
    request,
    setToken,
    getToken,
    get: (path, params) => request(path + query(params)),
    post: (path, body) => request(path, { method: "POST", body: body || {} }),
    put: (path, body) => request(path, { method: "PUT", body: body || {} }),
    patch: (path, body) => request(path, { method: "PATCH", body: body || {} }),
    del: (path) => request(path, { method: "DELETE" }),

    me: () => request("/api/auth/me"),
    logout: () => { setToken(""); return request("/api/auth/logout", { method: "POST" }); },

    // For the handful of call sites that need a raw fetch() (file
    // downloads/streams) instead of the JSON-only request() helper above.
    url: withBase,
    credentials: BASE ? "include" : "same-origin",
    authHeaders: () => (getToken() ? { Authorization: "Bearer " + getToken() } : {}),
  };
})();
