(function (global) {
  const C = global.GIFTS_CONFIG;

  function getToken() {
    try {
      return localStorage.getItem(C.TOKEN_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }

  function setToken(token) {
    try {
      if (token) localStorage.setItem(C.TOKEN_STORAGE_KEY, token);
      else localStorage.removeItem(C.TOKEN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  async function parseJson(res) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  async function loginWithQueryToken(token) {
    const q = encodeURIComponent(token);
    const res = await fetch(C.API_BASE + "/login?token=" + q, { credentials: "omit" });
    const json = await parseJson(res);
    if (!res.ok) throw new Error(json.message || json.status || "Login failed");
    return json;
  }

  async function me() {
    const res = await fetch(C.API_BASE + "/user/me", {
      headers: { Authorization: "Bearer " + getToken() },
      credentials: "omit",
    });
    const json = await parseJson(res);
    if (!res.ok) throw new Error(json.message || "Session expired");
    return json;
  }

  async function updateMe(nameOrBody) {
    const body =
      typeof nameOrBody === "string"
        ? { name: String(nameOrBody || "").trim() }
        : Object.assign({}, nameOrBody);
    if (!body.name || !String(body.name).trim()) throw new Error("Name required");
    body.name = String(body.name).trim();
    const res = await fetch(C.API_BASE + "/user/me", {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + getToken(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      credentials: "omit",
    });
    const json = await parseJson(res);
    if (!res.ok) throw new Error(json.message || "Update failed");
    return json;
  }

  async function verifyAppPassword(password) {
    const res = await fetch(C.API_BASE + "/user/me/verify-app-password", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + getToken(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: String(password || "") }),
      credentials: "omit",
    });
    const json = await parseJson(res);
    if (!res.ok) throw new Error(json.message || "Wrong password");
    return json;
  }

  async function authFetch(path, opts = {}) {
    const headers = Object.assign(
      { Authorization: "Bearer " + getToken() },
      opts.headers || {},
    );
    if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      opts = Object.assign({}, opts, {
        body: JSON.stringify(opts.body),
      });
    }
    const res = await fetch(C.API_BASE + path, Object.assign({ credentials: "omit" }, opts, { headers }));
    const json = await parseJson(res);
    if (!res.ok) throw new Error(json.message || res.statusText || "Request failed");
    return json;
  }

  /** Normalize list responses (including empty placeholder). */
  function listItems(json) {
    if (!json) return [];
    if (Array.isArray(json.data)) return json.data;
    if (json.data && Array.isArray(json.data.data)) return json.data.data;
    return [];
  }

  function unwrapData(json) {
    if (json && json.data !== undefined) return json.data;
    return json;
  }

  /** True when API_BASE is http:// while the site is HTTPS (GitHub Pages) — browsers block those requests. */
  function mixedContentBlocked() {
    try {
      if (typeof global.location === "undefined") return false;
      if (!global.isSecureContext) return false;
      return /^http:\/\//i.test(String(C.API_BASE || "").trim());
    } catch {
      return false;
    }
  }

  if (mixedContentBlocked()) {
    console.warn(
      "[Gifts] API_BASE uses http:// on an HTTPS site (e.g. GitHub Pages). Browsers block mixed content — use an HTTPS URL for API_BASE, or TLS in front of your backend (Cloudflare tunnel/proxy, Caddy/Let's Encrypt, etc.). See docs/js/config.js comments.",
    );
  }

  function streamUrlFromStorageKey(key) {
    if (!key) return "";
    const s = String(key).trim();
    if (/^blob:/i.test(s) || /^data:/i.test(s) || /^https?:\/\//i.test(s)) return s;
    const k = s.replace(/^uploads\//, "");
    return C.API_BASE + "/upload/stream/" + encodeURIComponent(k);
  }

  async function uploadFile(file) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(C.API_BASE + "/upload", {
      method: "POST",
      headers: { Authorization: "Bearer " + getToken() },
      body: fd,
      credentials: "omit",
    });
    const json = await parseJson(res);
    if (!res.ok) throw new Error(json.message || "Upload failed");
    const data = unwrapData(json);
    if (typeof data === "string") return data;
    if (data && typeof data.key === "string") return data.key;
    throw new Error("Upload failed");
  }

  global.GiftsApi = {
    getToken,
    setToken,
    loginWithQueryToken,
    me,
    updateMe,
    authFetch,
    listItems,
    unwrapData,
    streamUrlFromStorageKey,
    uploadFile,
    mixedContentBlocked,
    verifyAppPassword,
  };
})(typeof window !== "undefined" ? window : globalThis);
