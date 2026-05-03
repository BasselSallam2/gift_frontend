(function () {
  const api = window.GiftsApi;
  const router = window.GiftsRouter;

  let session = null;
  let galleryItems = [];
  let anniversaryCountdownTimer = null;
  let partnerMoodCache = { emoji: "", when: "" };
  let loveOpen = false;
  let lovePartnerToday = null;
  let loveMineToday = null;
  let dreamCompleteTargetId = null;
  const LS_ANNIV = "gifts.v1.anniversaryRows";
  const LS_GALLERY = "gifts.v1.galleryRows";
  const LS_MOOD = "gifts.v1.moodRows";
  const CACHE_TTL_MS = 10 * 60 * 1000;
  let anniversaryRowsSnapshot = [];
  let placesRowsCache = [];

  function toast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("visible");
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.classList.remove("visible");
    }, 2800);
  }

  function flashSuccessBtn(el) {
    if (!el || !el.classList) return;
    el.classList.remove("is-flash-success");
    void el.offsetWidth;
    el.classList.add("is-flash-success");
    clearTimeout(el._flashT);
    el._flashT = setTimeout(function () {
      el.classList.remove("is-flash-success");
    }, 500);
  }

  function readLsCache(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o.ts !== "number" || Date.now() - o.ts > CACHE_TTL_MS) return null;
      return o.data;
    } catch (e) {
      return null;
    }
  }

  function writeLsCache(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data }));
    } catch (e) {}
  }

  function showGate(message) {
    const gate = document.getElementById("gate");
    const app = document.getElementById("app-root");
    if (gate) gate.hidden = false;
    if (app) app.hidden = true;
    const m = document.getElementById("gate-message");
    if (m) {
      m.textContent =
        message != null && String(message).trim()
          ? String(message)
          : "Open this app using your private link with ?token= in the URL.";
    }
  }

  function showApp() {
    const gate = document.getElementById("gate");
    const app = document.getElementById("app-root");
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
  }

  function imageDisplayUrl(url) {
    if (url == null) return "";
    if (typeof url === "object" && url && typeof url.key === "string") return imageDisplayUrl(url.key);
    const s = String(url).trim();
    if (!s) return "";
    // Local preview URLs (must not hit /upload/stream/)
    if (/^blob:/i.test(s) || /^data:/i.test(s)) return s;
    if (/^https?:\/\//i.test(s)) return s;
    return api.streamUrlFromStorageKey(s);
  }

  /** Prefer `<img src>`; if blocked, retry via fetch + blob (Helmet/CORP dev quirks). */
  function bindSmartImage(img, url) {
    const src = imageDisplayUrl(url);
    if (/^blob:/i.test(src) || /^data:/i.test(src)) {
      img.removeAttribute("crossorigin");
    } else {
      img.crossOrigin = "anonymous";
    }
    img.referrerPolicy = "no-referrer";
    let blobTried = false;
    img.onerror = function () {
      if (blobTried || !src) return;
      if (/^(blob:|data:)/i.test(src)) return;
      blobTried = true;
      fetch(src, { credentials: "omit", mode: "cors" })
        .then(function (r) {
          if (!r.ok) return null;
          return r.blob();
        })
        .then(function (blob) {
          if (!blob) return;
          const u = URL.createObjectURL(blob);
          img.onload = function () {
            URL.revokeObjectURL(u);
          };
          img.src = u;
        })
        .catch(function () {});
    };
    img.src = src || "";
  }

  function formatTimeAgo(iso) {
    if (!iso) return "";
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return "";
    let s = Math.floor((Date.now() - t) / 1000);
    if (s < 0) s = 0;
    if (s < 10) return "just now";
    if (s < 60) return s + " sec ago";
    const m = Math.floor(s / 60);
    if (m < 60) return m + " min ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + " hour" + (h === 1 ? "" : "s") + " ago";
    const d = Math.floor(h / 24);
    if (d < 7) return d + " day" + (d === 1 ? "" : "s") + " ago";
    const w = Math.floor(d / 7);
    if (w < 8) return w + " wk ago";
    return new Date(iso).toLocaleDateString();
  }

  function formatCompactCountdown(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const days = Math.floor(s / 86400);
    const hrs = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (days > 0) return days + "d " + hrs + "h " + m + "m " + sec + "s";
    if (hrs > 0) return hrs + "h " + m + "m " + sec + "s";
    if (m > 0) return m + "m " + sec + "s";
    return sec + "s";
  }

  function updateAnniversaryCountdownEls() {
    document.querySelectorAll("[data-anniv-until]").forEach(function (el) {
      const t = Number(el.getAttribute("data-anniv-until"));
      if (!t) return;
      el.textContent = formatCompactCountdown(t - Date.now());
    });
  }

  function tickMoodRelativeLabels() {
    document.querySelectorAll("[data-mood-ago]").forEach(function (el) {
      const raw = el.getAttribute("data-mood-ago");
      el.textContent = formatTimeAgo(raw);
    });
  }

  function setSessionFromPayload(data) {
    session = data;
    if (data && data.user && data.user.token) api.setToken(data.user.token);
    window.applyThemeFromCouple(data && data.couple);
    syncHeaderPartnerName();
  }

  async function bootstrap() {
    const params = new URLSearchParams(window.location.search);
    const qt = params.get("token");
    if (api.mixedContentBlocked && api.mixedContentBlocked()) {
      showGate(
        "HTTPS site ↔ HTTP API cannot work (blocked by browsers). Terminate HTTPS in front of your backend (Coolify certs, nginx/Caddy Let’s Encrypt, Cloudflare Tunnel, etc.) or move the SPA to plain HTTP alongside the API.",
      );
      return;
    }
    try {
      if (qt) {
        const json = await api.loginWithQueryToken(qt);
        const data = api.unwrapData(json);
        api.setToken(qt);
        setSessionFromPayload(data);
        const clean = window.location.pathname + window.location.hash;
        window.history.replaceState({}, "", clean);
        showApp();
        return;
      }
      if (api.getToken()) {
        const json = await api.me();
        const data = api.unwrapData(json);
        setSessionFromPayload(data);
        showApp();
        return;
      }
    } catch (e) {
      api.setToken("");
      const msg =
        e && typeof e.message === "string" && e.message.trim()
          ? e.message
          : "Could not open your space.";
      showGate(msg);
      return;
    }
    showGate("Use your private link to sign in.");
  }

  function myId() {
    return session && session.user && String(session.user._id);
  }

  function coupleId() {
    return session && session.user && session.user.coupleId && String(session.user.coupleId);
  }

  function partner() {
    return session && session.partner;
  }

  function partnerDisplayName() {
    const p = partner();
    if (p && p.name != null && String(p.name).trim()) return String(p.name).trim();
    return "Partner";
  }

  function syncHeaderPartnerName() {
    const el = document.getElementById("header-partner-label");
    if (el) el.textContent = partnerDisplayName();
  }

  function calendarDayLocal(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  const EMOJI_PIC = /\p{Extended_Pictographic}/u;
  function normalizeSingleMoodEmoji(raw) {
    const s = raw == null ? "" : String(raw);
    if (!s) return "";
    let first = "";
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
      for (const part of seg.segment(s)) {
        first = part.segment;
        break;
      }
    } else {
      const cp = s.codePointAt(0);
      first = cp != null ? String.fromCodePoint(cp) : s.slice(0, 1);
    }
    if (EMOJI_PIC.test(first)) return first;
    return "";
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const p1 = (lat1 * Math.PI) / 180;
    const p2 = (lat2 * Math.PI) / 180;
    const dp = ((lat2 - lat1) * Math.PI) / 180;
    const dl = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dp / 2) * Math.sin(dp / 2) +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  let moodHistoryAllRows = [];

  function openImageLightbox(storageKeyOrUrl) {
    const el = document.getElementById("image-lightbox");
    const img = document.getElementById("image-lightbox-img");
    if (!el || !img) return;
    bindSmartImage(img, storageKeyOrUrl);
    el.hidden = false;
  }

  function closeImageLightbox() {
    const el = document.getElementById("image-lightbox");
    if (el) el.hidden = true;
  }

  async function refreshSession() {
    const json = await api.me();
    setSessionFromPayload(api.unwrapData(json));
  }

  function renderHomeHeader() {
    const c = session && session.couple;
    document.getElementById("home-title-display").textContent = (c && c.homeTitle) || "Our space";
    document.getElementById("home-message-display").textContent = (c && c.homeMessage) || "";
    document.getElementById("input-home-title").value = (c && c.homeTitle) || "";
    document.getElementById("input-home-message").value = (c && c.homeMessage) || "";
    const inh = document.getElementById("input-home-anniversary-heading");
    if (inh) inh.value = (c && c.anniversarySectionTitle) || "";
    const p = partner();
    document.getElementById("partner-mood-preview").textContent = "—";
    const av = document.getElementById("partner-avatar");
    if (av && p) av.textContent = "💕";
    syncHeaderPartnerName();
  }

  document.getElementById("btn-save-home-copy").addEventListener("click", async function () {
    if (!coupleId()) return toast("Pair with your partner first.");
    const title = document.getElementById("input-home-title").value.trim();
    const message = document.getElementById("input-home-message").value.trim();
    const annHeadInp = document.getElementById("input-home-anniversary-heading");
    const anniversarySectionTitle = annHeadInp ? annHeadInp.value.trim() : "";
    const btn = this;
    try {
      await api.authFetch("/couple/" + coupleId(), {
        method: "PUT",
        body: {
          homeTitle: title,
          homeMessage: message,
          anniversarySectionTitle: anniversarySectionTitle,
        },
      });
      document.getElementById("home-title-display").textContent = title || "Our space";
      document.getElementById("home-message-display").textContent = message || "";
      await refreshSession();
      renderHomeHeader();
      flashSuccessBtn(btn);
      toast("Saved");
      loadAnniversary().catch(function () {});
    } catch (e) {
      toast(e.message);
    }
  });

  function preloadGalleryImagesForItems(items) {
    const n = Math.min(items.length, 14);
    for (let i = 0; i < n; i++) {
      const item = items[i];
      if (!item) continue;
      const u = imageDisplayUrl(item.imageUrl);
      if (!u) continue;
      const im = new Image();
      im.src = u;
    }
  }

  function renderGalleryDeck() {
    const deck = document.getElementById("photo-deck");
    const empty = document.getElementById("deck-empty");
    if (!deck || !empty) return;
    deck.querySelectorAll(".deck-card").forEach(function (n) {
      n.remove();
    });
    if (!galleryItems.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    const topThree = galleryItems.slice(0, 3);
    topThree.reverse().forEach(function (item, idx) {
      const card = document.createElement("div");
      const isTop = idx === topThree.length - 1;
      card.className = "deck-card" + (isTop ? " is-top" : idx === topThree.length - 2 ? " is-back-1" : " is-back-2");
      card.dataset.id = String(item._id);
      const img = document.createElement("img");
      img.alt = "Memory";
      bindSmartImage(img, item.imageUrl);
      card.appendChild(img);
      if (isTop) bindSwipe(card, item);
      deck.appendChild(card);
    });
    preloadGalleryImagesForItems(galleryItems);
  }

  async function loadGallery() {
    const cached = readLsCache(LS_GALLERY);
    let showedCache = false;
    if (cached && Array.isArray(cached) && cached.length) {
      galleryItems = cached;
      renderGalleryDeck();
      showedCache = true;
    }
    try {
      const json = await api.authFetch("/home-gallery-image?limit=100&sort=-sortOrder");
      galleryItems = api.listItems(json);
      writeLsCache(LS_GALLERY, galleryItems);
      renderGalleryDeck();
    } catch (e) {
      if (!showedCache) toast(e.message);
    }
  }

  function bindSwipe(card, item) {
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;
    let raf = null;
    function applyTransform() {
      raf = null;
      card.style.transform = "translate(" + dx + "px," + dy + "px) rotate(" + dx * 0.05 + "deg)";
    }
    function onDown(ev) {
      const t = ev.touches ? ev.touches[0] : ev;
      startX = t.clientX;
      startY = t.clientY;
      dx = 0;
      dy = 0;
      if (raf != null) cancelAnimationFrame(raf);
      raf = null;
      card.classList.remove("deck-card--spring");
      card.classList.remove("deck-card--peel-active");
      card.style.transition = "none";
      card.style.opacity = "";
      card.style.transform = "";
    }
    function onMove(ev) {
      const t = ev.touches ? ev.touches[0] : ev;
      dx = t.clientX - startX;
      dy = t.clientY - startY;
      if (raf == null) raf = requestAnimationFrame(applyTransform);
    }
    function onUp() {
      if (raf != null) cancelAnimationFrame(raf);
      raf = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      card.removeEventListener("touchmove", onMove);
      card.removeEventListener("touchend", onUp);
      const shouldPeel = Math.abs(dx) > 80 || Math.abs(dy) > 80;
      if (shouldPeel) {
        const mag = Math.sqrt(dx * dx + dy * dy) || 1;
        const flyX = (dx / mag) * 420;
        const flyY = (dy / mag) * 420;
        card.classList.remove("deck-card--spring");
        card.classList.add("deck-card--peel-active");
        card.style.transition =
          "transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.28s ease-out";
        card.style.opacity = "0";
        card.style.transform =
          "translate(" + flyX + "px," + flyY + "px) rotate(" + flyX * 0.06 + "deg)";
        let peeled = false;
        function finishPeel() {
          if (peeled) return;
          peeled = true;
          card.removeEventListener("transitionend", onEnd);
          clearTimeout(fallbackT);
          peelCard(item);
        }
        function onEnd(ev) {
          if (ev.propertyName !== "transform") return;
          finishPeel();
        }
        card.addEventListener("transitionend", onEnd);
        const fallbackT = setTimeout(finishPeel, 420);
        return;
      }
      card.classList.add("deck-card--spring");
      card.style.removeProperty("transition");
      card.style.opacity = "";
      card.style.transform = "translate(0,0) rotate(0deg)";
      const done = function () {
        card.removeEventListener("transitionend", done);
        card.classList.remove("deck-card--spring");
        card.style.transition = "none";
        card.style.transform = "";
      };
      card.addEventListener("transitionend", done, { once: true });
      setTimeout(done, 320);
    }
    card.addEventListener("mousedown", function (e) {
      onDown(e);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    card.addEventListener("touchstart", onDown, { passive: true });
    card.addEventListener("touchmove", onMove, { passive: true });
    card.addEventListener("touchend", onUp);
  }

  async function peelCard(item) {
    const backup = galleryItems.map(function (g) {
      return Object.assign({}, g);
    });
    const others = galleryItems.filter(function (g) {
      return String(g._id) !== String(item._id);
    });
    const minOrder = others.length
      ? Math.min.apply(
          null,
          others.map(function (g) {
            return g.sortOrder != null ? g.sortOrder : 0;
          }),
        )
      : 0;
    const newOrder = minOrder - 1;
    galleryItems = galleryItems.map(function (g) {
      if (String(g._id) === String(item._id)) {
        return Object.assign({}, g, { sortOrder: newOrder });
      }
      return g;
    });
    galleryItems.sort(function (a, b) {
      return (b.sortOrder != null ? b.sortOrder : 0) - (a.sortOrder != null ? a.sortOrder : 0);
    });
    renderGalleryDeck();
    writeLsCache(LS_GALLERY, galleryItems);
    try {
      await api.authFetch("/home-gallery-image/" + item._id, {
        method: "PUT",
        body: { sortOrder: newOrder },
      });
    } catch (e) {
      galleryItems = backup;
      renderGalleryDeck();
      writeLsCache(LS_GALLERY, galleryItems);
      toast(e.message);
    }
  }

  document.getElementById("btn-add-gallery").addEventListener("click", function () {
    document.getElementById("input-gallery-file").click();
  });

  document.getElementById("input-gallery-file").addEventListener("change", function () {
    const f = this.files && this.files[0];
    if (!f) return;
    const inputEl = this;
    const maxOrder = galleryItems.length
      ? Math.max.apply(
          null,
          galleryItems.map(function (g) {
            return g.sortOrder != null ? g.sortOrder : 0;
          }),
        )
      : 0;
    const nextOrder = maxOrder + 1;
    const tempId = "_tmp_" + Date.now();
    const blobUrl = URL.createObjectURL(f);
    galleryItems = [{ _id: tempId, imageUrl: blobUrl, sortOrder: nextOrder }].concat(galleryItems);
    renderGalleryDeck();
    inputEl.value = "";
    flashSuccessBtn(document.getElementById("btn-add-gallery"));
    toast("Photo added");

    api
      .uploadFile(f)
      .then(function (key) {
        const url = typeof key === "string" ? key : key;
        galleryItems = galleryItems.map(function (g) {
          return String(g._id) === tempId ? Object.assign({}, g, { imageUrl: url }) : g;
        });
        URL.revokeObjectURL(blobUrl);
        renderGalleryDeck();
        return api.authFetch("/home-gallery-image", {
          method: "POST",
          body: { imageUrl: url, sortOrder: nextOrder },
        });
      })
      .then(function (json) {
        const created = api.unwrapData(json);
        const realId = created && created._id;
        if (realId) {
          galleryItems = galleryItems.map(function (g) {
            return String(g._id) === tempId ? Object.assign({}, g, { _id: realId }) : g;
          });
        }
        writeLsCache(LS_GALLERY, galleryItems);
        renderGalleryDeck();
      })
      .catch(function (e) {
        galleryItems = galleryItems.filter(function (g) {
          return String(g._id) !== tempId;
        });
        URL.revokeObjectURL(blobUrl);
        renderGalleryDeck();
        toast(e.message);
      });
  });

  function stopAnniversaryTimer() {
    if (anniversaryCountdownTimer) {
      clearInterval(anniversaryCountdownTimer);
      anniversaryCountdownTimer = null;
    }
  }

  function enrichAnniversaryApiRows(rows) {
    const now = Date.now();
    const yearMs = 365.25 * 24 * 3600 * 1000;
    return rows
      .map(function (a) {
        if (!a.eventDate) return null;
        const t = new Date(a.eventDate).getTime();
        let target = t;
        while (target < now) target += yearMs;
        return {
          title: a.title || "Anniversary",
          eventDate: a.eventDate,
          nextTs: target,
          imageUrl: a.imageUrl,
        };
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return a.nextTs - b.nextTs;
      });
  }

  function appendAnnivCard(listEl, a) {
      const card = document.createElement("div");
      card.className =
        "anniv-countdown-card anniv-countdown-card--grid flex rounded-[20px] border border-black/10 bg-surface shadow-[0_6px_24px_rgba(128,80,98,0.12)] ring-1 ring-black/[0.04]";
      const thumbWrap = document.createElement("div");
      thumbWrap.className =
        "anniv-countdown-card__thumb rounded-xl overflow-hidden bg-gradient-to-br from-primary/15 to-secondary/10 border border-black/5 shrink-0";
      if (a.imageUrl) {
        const img = document.createElement("img");
        img.className = "w-full h-full object-cover min-h-[3.5rem]";
        bindSmartImage(img, a.imageUrl);
        thumbWrap.appendChild(img);
      } else {
        thumbWrap.classList.add("flex", "items-center", "justify-center", "text-xl", "min-h-[3.5rem]");
        thumbWrap.textContent = "📅";
      }
      const body = document.createElement("div");
      body.className = "anniv-countdown-card__body min-w-0 flex flex-col justify-center gap-1";
      const tEl = document.createElement("div");
      tEl.className = "font-semibold text-xs text-on-surface line-clamp-2";
      tEl.textContent = a.title;
      const chip = document.createElement("div");
      chip.className = "text-[9px] uppercase tracking-wide text-on-surface-variant";
      chip.textContent = new Date(a.eventDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const cdWrap = document.createElement("div");
      cdWrap.className =
        "anniv-countdown-card__countdown inline-flex items-center justify-center rounded-lg bg-primary-container px-2 py-1.5 w-full border border-primary/15";
      const cd = document.createElement("div");
      cd.className = "font-display text-sm text-primary tabular-nums font-bold leading-none";
      cd.setAttribute("data-anniv-until", String(a.nextTs));
      cd.textContent = formatCompactCountdown(a.nextTs - Date.now());
      cdWrap.appendChild(cd);
      body.appendChild(tEl);
      body.appendChild(chip);
      body.appendChild(cdWrap);
      card.appendChild(thumbWrap);
      card.appendChild(body);
      listEl.appendChild(card);
  }

  function renderAnniversaryListDom(enriched, listEl, doClear) {
    if (doClear !== false) listEl.innerHTML = "";
    enriched.forEach(function (a) {
      appendAnnivCard(listEl, a);
    });
    updateAnniversaryCountdownEls();
  }

  async function loadAnniversary() {
    const listEl = document.getElementById("anniversary-list");
    const hintEl = document.getElementById("anniversary-empty-hint");
    const headEl = document.getElementById("anniversary-section-heading");
    if (!listEl) return;

    const c = session && session.couple;
    if (headEl) headEl.textContent = (c && c.anniversarySectionTitle) || "Our milestones";

    stopAnniversaryTimer();

    const cached = readLsCache(LS_ANNIV);
    let showedCache = false;
    if (cached && Array.isArray(cached) && cached.length) {
      const enriched = enrichAnniversaryApiRows(cached);
      if (enriched.length) {
        anniversaryRowsSnapshot = cached.slice();
        if (hintEl) hintEl.hidden = true;
        renderAnniversaryListDom(enriched, listEl, true);
        showedCache = true;
        anniversaryCountdownTimer = setInterval(updateAnniversaryCountdownEls, 1000);
      }
    }

    try {
      const json = await api.authFetch("/anniversary?limit=50");
      const rows = api.listItems(json);
      anniversaryRowsSnapshot = rows.slice();
      writeLsCache(LS_ANNIV, rows);
      stopAnniversaryTimer();
      listEl.innerHTML = "";
      if (!rows.length) {
        anniversaryRowsSnapshot = [];
        if (hintEl) hintEl.hidden = false;
        return;
      }
      if (hintEl) hintEl.hidden = true;
      const enriched = enrichAnniversaryApiRows(rows);
      renderAnniversaryListDom(enriched, listEl, false);
      anniversaryCountdownTimer = setInterval(updateAnniversaryCountdownEls, 1000);
    } catch (e) {
      if (!showedCache) {
        anniversaryRowsSnapshot = [];
        listEl.innerHTML = "";
        if (hintEl) hintEl.hidden = false;
      }
    }
  }

  document.getElementById("btn-add-anniversary").addEventListener("click", function () {
    document.getElementById("anniversary-editor").classList.toggle("hidden");
  });

  document.getElementById("btn-save-anniversary").addEventListener("click", function () {
    const title = document.getElementById("input-anniversary-title").value.trim();
    const d = document.getElementById("input-anniversary-date").value;
    if (!title || !d) return toast("Title and date required");
    const photoInp = document.getElementById("input-anniversary-photo");
    const saveBtn = this;
    const listEl = document.getElementById("anniversary-list");
    const hintEl = document.getElementById("anniversary-empty-hint");
    const headEl = document.getElementById("anniversary-section-heading");
    const f = photoInp && photoInp.files && photoInp.files[0];
    const blobThumbUrl = f ? URL.createObjectURL(f) : null;
    const tempAnnId = "_tmp_ann_" + Date.now();

    anniversaryRowsSnapshot = anniversaryRowsSnapshot.concat([
      {
        _id: tempAnnId,
        title: title,
        eventDate: d,
        imageUrl: blobThumbUrl || undefined,
      },
    ]);
    if (photoInp) photoInp.value = "";
    document.getElementById("input-anniversary-title").value = "";
    document.getElementById("input-anniversary-date").value = "";
    document.getElementById("anniversary-editor").classList.add("hidden");

    stopAnniversaryTimer();
    if (listEl) listEl.innerHTML = "";
    const c = session && session.couple;
    if (headEl) headEl.textContent = (c && c.anniversarySectionTitle) || "Our milestones";
    const enrichedOpt = enrichAnniversaryApiRows(anniversaryRowsSnapshot);
    if (!enrichedOpt.length) {
      if (hintEl) hintEl.hidden = false;
    } else {
      if (hintEl) hintEl.hidden = true;
      renderAnniversaryListDom(enrichedOpt, listEl, false);
    }
    anniversaryCountdownTimer = setInterval(updateAnniversaryCountdownEls, 1000);
    flashSuccessBtn(saveBtn);
    toast("Saved");
    writeLsCache(LS_ANNIV, anniversaryRowsSnapshot);

    const uploadP = f ? api.uploadFile(f) : Promise.resolve(null);
    uploadP
      .then(function (imageUrl) {
        const body = { title: title, eventDate: d };
        if (imageUrl) body.imageUrl = imageUrl;
        return api.authFetch("/anniversary", {
          method: "POST",
          body: body,
        }).then(function (json) {
          return { json: json, imageUrl: imageUrl };
        });
      })
      .then(function (pack) {
        const created = api.unwrapData(pack.json);
        const newId = created && created._id;
        const resolvedImage = (created && created.imageUrl) || pack.imageUrl;
        anniversaryRowsSnapshot = anniversaryRowsSnapshot.map(function (row) {
          if (String(row._id) !== String(tempAnnId)) return row;
          return {
            _id: newId || row._id,
            title: title,
            eventDate: d,
            imageUrl: resolvedImage != null ? resolvedImage : row.imageUrl,
          };
        });
        if (blobThumbUrl) URL.revokeObjectURL(blobThumbUrl);
        writeLsCache(LS_ANNIV, anniversaryRowsSnapshot);
        stopAnniversaryTimer();
        if (listEl) listEl.innerHTML = "";
        if (headEl) headEl.textContent = (c && c.anniversarySectionTitle) || "Our milestones";
        const enriched = enrichAnniversaryApiRows(anniversaryRowsSnapshot);
        if (!enriched.length) {
          if (hintEl) hintEl.hidden = false;
        } else {
          if (hintEl) hintEl.hidden = true;
          renderAnniversaryListDom(enriched, listEl, false);
        }
        anniversaryCountdownTimer = setInterval(updateAnniversaryCountdownEls, 1000);
      })
      .catch(function (e) {
        if (blobThumbUrl) URL.revokeObjectURL(blobThumbUrl);
        anniversaryRowsSnapshot = anniversaryRowsSnapshot.filter(function (row) {
          return String(row._id) !== String(tempAnnId);
        });
        writeLsCache(LS_ANNIV, anniversaryRowsSnapshot);
        toast(e.message);
        stopAnniversaryTimer();
        if (listEl) listEl.innerHTML = "";
        if (headEl) headEl.textContent = (session && session.couple && session.couple.anniversarySectionTitle) || "Our milestones";
        const enrichedFail = enrichAnniversaryApiRows(anniversaryRowsSnapshot);
        if (!enrichedFail.length) {
          if (hintEl) hintEl.hidden = false;
        } else {
          if (hintEl) hintEl.hidden = true;
          renderAnniversaryListDom(enrichedFail, listEl, false);
        }
        anniversaryCountdownTimer = setInterval(updateAnniversaryCountdownEls, 1000);
      });
  });

  function renderPartnerMoodPreview() {
    const el = document.getElementById("partner-mood-preview");
    if (!el) return;
    if (!partnerMoodCache.emoji && !partnerMoodCache.when) {
      el.textContent = "—";
      return;
    }
    if (!partnerMoodCache.when) {
      el.textContent = partnerMoodCache.emoji || "—";
      return;
    }
    el.textContent = partnerMoodCache.emoji + " · " + formatTimeAgo(partnerMoodCache.when);
  }

  async function loadMoodPreview() {
    try {
      const json = await api.authFetch("/mood-share?limit=30&sort=-createdAt");
      const rows = api.listItems(json);
      const partnerId = partner() && partner()._id;
      const m = rows.find(function (r) {
        return partnerId && String(r.userId) === String(partnerId);
      });
      if (!m) {
        partnerMoodCache = { emoji: "", when: "" };
        renderPartnerMoodPreview();
        return;
      }
      partnerMoodCache = {
        emoji: m.emoji || "—",
        when: m.updatedAt || m.createdAt || "",
      };
      renderPartnerMoodPreview();
    } catch (e) {
      /* ignore */
    }
  }

  async function loadDailyShortcut() {
    try {
      await fetchLoveData();
      updateLoveComposeUi();
      updateLoveUnreadUi();
    } catch (e) {
      /* ignore */
    }
  }

  async function fetchLoveData() {
    try {
      const json = await api.authFetch("/daily-message?limit=50&sort=-createdAt");
      const rows = api.listItems(json);
      const today = new Date().toISOString().slice(0, 10);
      lovePartnerToday =
        rows.find(function (r) {
          return String(r.senderId) !== myId() && r.dayKey === today;
        }) || null;
      loveMineToday =
        rows.find(function (r) {
          return String(r.senderId) === myId() && r.dayKey === today;
        }) || null;
    } catch (e) {
      lovePartnerToday = null;
      loveMineToday = null;
      toast(e.message);
    }
  }

  function renderLovePaper() {
    const paper = document.getElementById("love-paper");
    if (!paper) return;
    if (lovePartnerToday) {
      paper.textContent = lovePartnerToday.body || "";
      return;
    }
    if (loveMineToday) {
      paper.textContent =
        "You’ve sent your note for today. Your partner hasn’t left one yet — check back later.";
      return;
    }
    paper.textContent = "No notes for today yet. Send something sweet below.";
  }

  function setLovePanelsClosed(open) {
    const closed = document.getElementById("love-closed-wrap");
    const openW = document.getElementById("love-open-wrap");
    if (closed) closed.hidden = !!open;
    if (openW) openW.classList.toggle("hidden", !open);
  }

  function updateLoveComposeUi() {
    const hint = document.getElementById("daily-compose-hint");
    const sendBtn = document.getElementById("btn-send-daily");
    if (loveMineToday) {
      if (hint) hint.textContent = "Sent for today.";
      if (sendBtn) sendBtn.disabled = true;
    } else {
      if (hint) hint.textContent = "";
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function updateLoveUnreadUi() {
    const flag = document.getElementById("love-unread-flag");
    const navDot = document.getElementById("nav-love-unread");
    const unread = lovePartnerToday && !lovePartnerToday.readAt;
    if (flag) flag.classList.toggle("hidden", !unread || loveOpen);
    if (navDot) navDot.classList.toggle("hidden", !unread);
  }

  async function loadLoveView() {
    await fetchLoveData();
    updateLoveComposeUi();
    updateLoveUnreadUi();
    if (loveOpen) renderLovePaper();
  }

  async function openLoveEnvelopeFromUser() {
    loveOpen = true;
    setLovePanelsClosed(true);
    if (lovePartnerToday && !lovePartnerToday.readAt) {
      try {
        await api.authFetch("/daily-message/" + lovePartnerToday._id, {
          method: "PUT",
          body: { readAt: new Date().toISOString() },
        });
        await fetchLoveData();
      } catch (e) {
        toast(e.message);
      }
    }
    renderLovePaper();
    updateLoveUnreadUi();
    await loadDailyShortcut();
  }

  function closeLoveEnvelope() {
    loveOpen = false;
    setLovePanelsClosed(false);
    updateLoveUnreadUi();
  }

  async function refreshHome() {
    renderHomeHeader();
    await Promise.all([loadGallery(), loadAnniversary(), loadMoodPreview(), loadDailyShortcut()]);
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function renderPlaceRowElement(p) {
    const row = document.createElement("div");
    row.className = "rounded-xl border border-black/10 bg-surface p-3 text-sm";
    if (p._id != null && p._id !== "") row.setAttribute("data-place-id", String(p._id));
    row.innerHTML =
      "<div class='font-semibold'>" +
      escapeHtml(p.name || "Place") +
      "</div><div class='text-xs text-on-surface-variant'>" +
      (p.visitDate ? new Date(p.visitDate).toLocaleDateString() : "") +
      "</div>";
    return row;
  }

  function insertOptimisticPlaceRow(partial) {
    const list = document.getElementById("place-list");
    if (!list) return;
    const rowEl = renderPlaceRowElement(partial);
    list.insertBefore(rowEl, list.firstChild);
    placesRowsCache = [partial].concat(
      placesRowsCache.filter(function (x) {
        return String(x._id) !== String(partial._id);
      }),
    );
    if (window.GiftsMaps) window.GiftsMaps.syncPlaces(placesRowsCache);
  }

  function confirmOptimisticPlace(tempId, serverPlace) {
    placesRowsCache = placesRowsCache.map(function (x) {
      return String(x._id) === String(tempId) ? serverPlace : x;
    });
    const list = document.getElementById("place-list");
    if (list) {
      const domRow = list.querySelector('[data-place-id="' + tempId + '"]');
      if (domRow && serverPlace) domRow.replaceWith(renderPlaceRowElement(serverPlace));
    }
    if (window.GiftsMaps) window.GiftsMaps.syncPlaces(placesRowsCache);
  }

  function revertOptimisticPlace(tempId) {
    placesRowsCache = placesRowsCache.filter(function (x) {
      return String(x._id) !== String(tempId);
    });
    const list = document.getElementById("place-list");
    if (list) {
      const domRow = list.querySelector('[data-place-id="' + tempId + '"]');
      if (domRow) domRow.remove();
    }
    if (window.GiftsMaps) window.GiftsMaps.syncPlaces(placesRowsCache);
  }

  document.getElementById("btn-send-daily").addEventListener("click", async function () {
    const body = document.getElementById("input-daily-body").value.trim();
    if (!body) return toast("Write something sweet first.");
    const btn = this;
    const prevMine = loveMineToday;
    document.getElementById("input-daily-body").value = "";
    loveMineToday = {
      _id: "_optimistic",
      dayKey: new Date().toISOString().slice(0, 10),
      body: body,
      senderId: myId(),
    };
    updateLoveComposeUi();
    if (loveOpen) renderLovePaper();
    try {
      await api.authFetch("/daily-message", { method: "POST", body: { body: body } });
      flashSuccessBtn(btn);
      await fetchLoveData();
      updateLoveComposeUi();
      if (loveOpen) renderLovePaper();
      await loadDailyShortcut();
      toast("Sent");
    } catch (e) {
      loveMineToday = prevMine;
      document.getElementById("input-daily-body").value = body;
      updateLoveComposeUi();
      if (loveOpen) renderLovePaper();
      toast(e.message);
    }
  });

  const loveEnvBtn = document.getElementById("love-envelope-btn");
  if (loveEnvBtn) {
    loveEnvBtn.addEventListener("click", function () {
      openLoveEnvelopeFromUser();
    });
  }
  const loveCloseBtn = document.getElementById("love-close-paper");
  if (loveCloseBtn) {
    loveCloseBtn.addEventListener("click", function () {
      closeLoveEnvelope();
    });
  }

  function setMoodComposeOpen(open) {
    const fields = document.getElementById("mood-compose-fields");
    const openBtn = document.getElementById("btn-mood-open-compose");
    if (fields) fields.classList.toggle("hidden", !open);
    if (openBtn) openBtn.classList.toggle("hidden", !!open);
    if (!open) {
      const em = document.getElementById("input-mood-emoji");
      const no = document.getElementById("input-mood-note");
      if (em) em.value = "";
      if (no) no.value = "";
    } else {
      const em = document.getElementById("input-mood-emoji");
      if (em)
        setTimeout(function () {
          em.focus();
        }, 60);
    }
  }

  const btnMoodOpen = document.getElementById("btn-mood-open-compose");
  if (btnMoodOpen) {
    btnMoodOpen.addEventListener("click", function () {
      setMoodComposeOpen(true);
    });
  }
  const btnMoodCancel = document.getElementById("btn-mood-compose-cancel");
  if (btnMoodCancel) {
    btnMoodCancel.addEventListener("click", function () {
      setMoodComposeOpen(false);
    });
  }

  const moodEmojiInp = document.getElementById("input-mood-emoji");
  if (moodEmojiInp) {
    moodEmojiInp.addEventListener("input", function () {
      const one = normalizeSingleMoodEmoji(moodEmojiInp.value);
      moodEmojiInp.value = one;
    });
  }

  function renderMoodRowEl(r, pname) {
    const mine = String(r.userId) === myId();
    const row = document.createElement("div");
    row.className = "flex items-start gap-3 py-2 border-b border-black/5 last:border-0";
    const em = document.createElement("span");
    em.className = "text-3xl shrink-0";
    em.textContent = r.emoji || "—";
    const col = document.createElement("div");
    col.className = "min-w-0 flex-1";
    const meta = document.createElement("div");
    meta.className = "text-xs text-on-surface-variant";
    const when = r.updatedAt || r.createdAt;
    const agoSpan = document.createElement("span");
    agoSpan.setAttribute("data-mood-ago", when || "");
    agoSpan.textContent = formatTimeAgo(when);
    meta.textContent = (mine ? "You" : pname) + " · ";
    meta.appendChild(agoSpan);
    const note = document.createElement("p");
    note.className = "text-sm mt-1 whitespace-pre-wrap";
    note.textContent = r.note || "";
    col.appendChild(meta);
    if (r.note) col.appendChild(note);
    row.appendChild(em);
    row.appendChild(col);
    return row;
  }

  function renderMoodHistorySheetList() {
    const list = document.getElementById("mood-history-sheet-list");
    const filterInp = document.getElementById("mood-history-filter-date");
    if (!list) return;
    list.innerHTML = "";
    const pname = partnerDisplayName();
    const filterDay = filterInp && filterInp.value ? filterInp.value : "";
    const filtered = moodHistoryAllRows.filter(function (r) {
      if (!filterDay) return true;
      const iso = r.updatedAt || r.createdAt;
      return calendarDayLocal(iso) === filterDay;
    });
    if (!filtered.length) {
      list.innerHTML = "<p class='text-sm text-on-surface-variant py-4'>No moods for this day.</p>";
      return;
    }
    filtered.forEach(function (r) {
      list.appendChild(renderMoodRowEl(r, pname));
    });
    tickMoodRelativeLabels();
  }

  function openMoodHistorySheet() {
    const sh = document.getElementById("mood-history-sheet");
    const filterInp = document.getElementById("mood-history-filter-date");
    if (filterInp) filterInp.value = "";
    if (sh) sh.hidden = false;
    renderMoodHistorySheetList();
  }

  function closeMoodHistorySheet() {
    const sh = document.getElementById("mood-history-sheet");
    if (sh) sh.hidden = true;
  }

  const moodHistBackdrop = document.getElementById("mood-history-sheet-backdrop");
  if (moodHistBackdrop) moodHistBackdrop.addEventListener("click", closeMoodHistorySheet);
  const moodHistClose = document.getElementById("mood-history-sheet-close");
  if (moodHistClose) moodHistClose.addEventListener("click", closeMoodHistorySheet);
  const moodHistFilter = document.getElementById("mood-history-filter-date");
  if (moodHistFilter) moodHistFilter.addEventListener("change", renderMoodHistorySheetList);
  const moodHistClear = document.getElementById("mood-history-filter-clear");
  if (moodHistClear)
    moodHistClear.addEventListener("click", function () {
      const f = document.getElementById("mood-history-filter-date");
      if (f) f.value = "";
      renderMoodHistorySheetList();
    });

  async function loadMoodPanel() {
    const box = document.getElementById("mood-latest");
    const histBtn = document.getElementById("btn-mood-history");
    const pname = partnerDisplayName();

    const cached = readLsCache(LS_MOOD);
    if (cached && Array.isArray(cached) && cached.length && box) {
      moodHistoryAllRows = cached;
      paintMoodRecentFromRows(cached, box, histBtn, pname);
    }

    try {
      const json = await api.authFetch("/mood-share?limit=50&sort=-createdAt");
      const rows = api.listItems(json);
      moodHistoryAllRows = rows;
      writeLsCache(LS_MOOD, rows);
      if (!rows.length) {
        box.innerHTML = "<p class='text-sm text-on-surface-variant'>No moods yet.</p>";
        if (histBtn) {
          histBtn.classList.add("hidden");
          histBtn.onclick = null;
        }
        return;
      }
      paintMoodRecentFromRows(rows, box, histBtn, pname);
      tickMoodRelativeLabels();
    } catch (e) {
      if (!cached || !cached.length) {
        box.innerHTML = "<p class='text-sm text-on-surface-variant'>Could not load moods.</p>";
      }
    }
  }

  function paintMoodRecentFromRows(rows, box, histBtn, pname) {
    const recent = rows.slice(0, 5);
    box.innerHTML = "";
    const title = document.createElement("p");
    title.className = "text-xs text-on-surface-variant mb-2";
    title.textContent = recent.length ? "Recent" : "Moods";
    box.appendChild(title);
    const recentWrap = document.createElement("div");
    recentWrap.id = "mood-recent-rows";
    recent.forEach(function (r) {
      recentWrap.appendChild(renderMoodRowEl(r, pname));
    });
    box.appendChild(recentWrap);
    if (histBtn) {
      const older = Math.max(0, rows.length - 5);
      histBtn.classList.toggle("hidden", older === 0);
      histBtn.textContent = older ? "Mood history (" + older + " more)" : "Mood history";
      histBtn.onclick = function () {
        openMoodHistorySheet();
      };
    }
  }

  document.getElementById("btn-share-mood").addEventListener("click", function () {
    const moodInp = document.getElementById("input-mood-emoji");
    const emoji = moodInp ? normalizeSingleMoodEmoji(moodInp.value) : "";
    if (!emoji) return toast("Pick one emoji first.");
    const note = document.getElementById("input-mood-note").value.trim();
    const sendBtn = this;
    const wrap = document.getElementById("mood-recent-rows");
    let optimisticEl = null;
    const nowIso = new Date().toISOString();
    if (wrap) {
      optimisticEl = renderMoodRowEl(
        {
          userId: myId(),
          emoji: emoji,
          note: note || "",
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        partnerDisplayName(),
      );
      optimisticEl.setAttribute("data-optimistic-mood", "1");
      wrap.insertBefore(optimisticEl, wrap.firstChild);
    }
    moodInp.value = "";
    document.getElementById("input-mood-note").value = "";
    setMoodComposeOpen(false);
    tickMoodRelativeLabels();
    flashSuccessBtn(sendBtn);
    toast("Mood shared");
    api
      .authFetch("/mood-share", {
        method: "POST",
        body: { emoji: emoji, note: note || undefined },
      })
      .then(function () {
        return Promise.all([loadMoodPreview(), loadMoodPanel()]).catch(function () {});
      })
      .catch(function (e) {
        if (optimisticEl && optimisticEl.parentNode) optimisticEl.parentNode.removeChild(optimisticEl);
        toast(e.message);
      });
  });

  function showDreamCompleteSheet(dream) {
    dreamCompleteTargetId = dream && dream._id ? String(dream._id) : null;
    const t = document.getElementById("dream-complete-title");
    if (t) t.textContent = (dream && dream.title) || "";
    const dInp = document.getElementById("dream-complete-date");
    if (dInp) {
      const base =
        dream && dream.doneAt
          ? new Date(dream.doneAt)
          : dream && dream.isDone
            ? new Date()
            : new Date();
      dInp.value = base.toISOString().slice(0, 10);
    }
    const ph = document.getElementById("dream-complete-photo");
    if (ph) ph.value = "";
    const sh = document.getElementById("dream-complete-sheet");
    if (sh) sh.hidden = false;
  }

  function hideDreamCompleteSheet() {
    dreamCompleteTargetId = null;
    const sh = document.getElementById("dream-complete-sheet");
    if (sh) sh.hidden = true;
  }

  function createDreamListItem(d, opts) {
    opts = opts || {};
    const outer = document.createElement("div");
    outer.className = "rounded-xl border border-black/10 bg-surface overflow-hidden";

    if (d.isDone) {
      const rule = document.createElement("div");
      rule.className = "dream-done-rule";
      outer.appendChild(rule);
    }

    const row = document.createElement("div");
    row.className = "flex items-center gap-2 p-3";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!d.isDone;
    if (opts.disableCheckbox) cb.disabled = true;

    cb.addEventListener("change", async function () {
      if (!d._id) return;
      if (cb.checked) {
        cb.checked = false;
        showDreamCompleteSheet(d);
        return;
      }
      try {
        await api.authFetch("/dream/" + d._id, {
          method: "PUT",
          body: {
            isDone: false,
            doneAt: null,
            completionImage: null,
          },
        });
        await loadDreams();
      } catch (e) {
        toast(e.message);
      }
    });
    row.appendChild(cb);

    const label = document.createElement("div");
    label.className = (d.isDone ? "flex-1 text-sm line-through opacity-75 " : "flex-1 text-sm ") + "min-w-0";
    label.textContent = d.title;
    row.appendChild(label);

    if (d.isDone) {
      const star = document.createElement("button");
      star.type = "button";
      star.setAttribute("aria-label", "View celebration photo");
      star.className =
        "material-symbols-outlined shrink-0 text-primary p-1 rounded-lg hover:bg-primary/10";
      star.textContent = "star";
      star.style.fontVariationSettings = "'FILL' 1";
      star.addEventListener("click", function () {
        if (d.completionImage) openImageLightbox(d.completionImage);
        else toast("No celebration photo yet");
      });
      row.appendChild(star);
    }

    outer.appendChild(row);
    return outer;
  }

  async function loadDreams() {
    const list = document.getElementById("dream-list");
    list.innerHTML = "";
    try {
      const json = await api.authFetch("/dream?limit=50&sort=-createdAt");
      const rows = api.listItems(json);
      rows.forEach(function (d) {
        list.appendChild(createDreamListItem(d));
      });
    } catch (e) {
      toast(e.message);
    }
  }

  document.getElementById("btn-add-dream").addEventListener("click", function () {
    const title = document.getElementById("input-dream-title").value.trim();
    if (!title) return;
    const list = document.getElementById("dream-list");
    const btn = this;
    const d = { title: title, isDone: false };
    const outer = createDreamListItem(d, { disableCheckbox: true });
    list.insertBefore(outer, list.firstChild);
    document.getElementById("input-dream-title").value = "";
    flashSuccessBtn(btn);
    toast("Added");
    api.authFetch("/dream", { method: "POST", body: { title: title } })
      .then(function (json) {
        Object.assign(d, api.unwrapData(json));
        const cb = outer.querySelector('input[type="checkbox"]');
        if (cb) cb.disabled = false;
      })
      .catch(function (e) {
        outer.remove();
        document.getElementById("input-dream-title").value = title;
        toast(e.message);
      });
  });

  document.getElementById("dream-complete-cancel").addEventListener("click", function () {
    hideDreamCompleteSheet();
  });
  document.getElementById("dream-complete-backdrop").addEventListener("click", function () {
    hideDreamCompleteSheet();
  });
  document.getElementById("dream-complete-save").addEventListener("click", async function () {
    const id = dreamCompleteTargetId;
    if (!id) return hideDreamCompleteSheet();
    const dateVal = document.getElementById("dream-complete-date").value;
    const doneAt = dateVal ? new Date(dateVal + "T12:00:00").toISOString() : new Date().toISOString();
    let completionImage;
    const f = document.getElementById("dream-complete-photo").files[0];
    if (f) {
      try {
        completionImage = await api.uploadFile(f);
      } catch (e) {
        return toast(e.message);
      }
    }
    try {
      const body = {
        isDone: true,
        doneAt: doneAt,
      };
      if (completionImage) body.completionImage = completionImage;
      await api.authFetch("/dream/" + id, {
        method: "PUT",
        body: body,
      });
      hideDreamCompleteSheet();
      await loadDreams();
      toast("Dream celebrated");
    } catch (e) {
      toast(e.message);
    }
  });

  document.getElementById("image-lightbox-close").addEventListener("click", closeImageLightbox);
  document.getElementById("image-lightbox").addEventListener("click", function (e) {
    if (e.target.id === "image-lightbox") closeImageLightbox();
  });

  async function loadPlaces() {
    const list = document.getElementById("place-list");
    list.innerHTML = "";
    let rows = [];
    try {
      const json = await api.authFetch("/shared-place?limit=50");
      rows = api.listItems(json);
      placesRowsCache = rows.slice();
      rows.forEach(function (p) {
        list.appendChild(renderPlaceRowElement(p));
      });
    } catch (e) {
      toast(e.message || "Could not load places");
      placesRowsCache = [];
    }
    if (window.GiftsMaps) window.GiftsMaps.syncPlaces(rows);
  }

  async function loadAchievements() {
    const list = document.getElementById("achievement-list");
    list.innerHTML = "";
    try {
      const json = await api.authFetch("/achievement?limit=50&sort=-createdAt");
      const rows = api.listItems(json);
      rows.forEach(function (a) {
        const item = document.createElement("div");
        item.className = "wins-timeline__item";
        const rail = document.createElement("div");
        rail.className = "wins-timeline__rail";
        const dot = document.createElement("div");
        dot.className = "wins-timeline__dot";
        rail.appendChild(dot);
        const card = document.createElement("div");
        card.className = "wins-timeline__card rounded-2xl border border-black/10 bg-surface shadow-sm overflow-hidden min-w-0";
        if (a.photo) {
          const img = document.createElement("img");
          img.className = "w-full h-28 object-cover cursor-pointer";
          bindSmartImage(img, a.photo);
          img.addEventListener("click", function () {
            openImageLightbox(a.photo);
          });
          card.appendChild(img);
        }
        const cap = document.createElement("div");
        cap.className = "p-3";
        const titleEl = document.createElement("div");
        titleEl.className = "text-sm font-semibold text-on-surface";
        titleEl.textContent = a.title;
        cap.appendChild(titleEl);
        if (a.achievedDate) {
          const dateEl = document.createElement("div");
          dateEl.className = "text-[11px] text-on-surface-variant mt-1";
          dateEl.textContent = new Date(a.achievedDate).toLocaleDateString();
          cap.appendChild(dateEl);
        }
        card.appendChild(cap);
        item.appendChild(rail);
        item.appendChild(card);
        list.appendChild(item);
      });
    } catch (e) {
      toast(e.message || "Could not load wins");
    }
  }

  document.getElementById("btn-toggle-wins-form").addEventListener("click", function () {
    document.getElementById("wins-add-panel").classList.toggle("hidden");
  });

  document.getElementById("btn-add-achievement").addEventListener("click", function () {
    const title = document.getElementById("input-ach-title").value.trim();
    const achievedDate = document.getElementById("input-ach-date").value;
    if (!title) return toast("Title required");
    const btn = this;
    const f = document.getElementById("input-ach-photo").files[0];
    const blobUrl = f ? URL.createObjectURL(f) : null;

    const list = document.getElementById("achievement-list");
    const tempItem = document.createElement("div");
    tempItem.className = "wins-timeline__item";
    tempItem.setAttribute("data-temp-win", "1");
    const rail = document.createElement("div");
    rail.className = "wins-timeline__rail";
    const dot = document.createElement("div");
    dot.className = "wins-timeline__dot";
    rail.appendChild(dot);
    const card = document.createElement("div");
    card.className = "wins-timeline__card rounded-2xl border border-black/10 bg-surface shadow-sm overflow-hidden min-w-0";
    if (blobUrl) {
      const img = document.createElement("img");
      img.className = "w-full h-28 object-cover cursor-pointer";
      img.src = blobUrl;
      img.alt = "";
      img.addEventListener("click", function () {
        openImageLightbox(blobUrl);
      });
      card.appendChild(img);
    }
    const cap = document.createElement("div");
    cap.className = "p-3";
    const titleEl = document.createElement("div");
    titleEl.className = "text-sm font-semibold text-on-surface";
    titleEl.textContent = title;
    cap.appendChild(titleEl);
    if (achievedDate) {
      const dateEl = document.createElement("div");
      dateEl.className = "text-[11px] text-on-surface-variant mt-1";
      dateEl.textContent = new Date(achievedDate).toLocaleDateString();
      cap.appendChild(dateEl);
    }
    card.appendChild(cap);
    tempItem.appendChild(rail);
    tempItem.appendChild(card);
    list.insertBefore(tempItem, list.firstChild);
    const savedTitle = title;
    const savedDate = achievedDate;
    document.getElementById("input-ach-title").value = "";
    document.getElementById("input-ach-date").value = "";
    document.getElementById("input-ach-photo").value = "";
    flashSuccessBtn(btn);
    toast("Added");

    const uploadP = f ? api.uploadFile(f) : Promise.resolve(null);
    uploadP
      .then(function (photo) {
        return api.authFetch("/achievement", {
          method: "POST",
          body: { title: savedTitle, achievedDate: savedDate || undefined, photo: photo || undefined },
        });
      })
      .then(function (json) {
        const created = api.unwrapData(json);
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        tempItem.removeAttribute("data-temp-win");
        const imgEl = card.querySelector("img");
        if (created && created.photo) {
          if (imgEl) {
            bindSmartImage(imgEl, created.photo);
            imgEl.onclick = function () {
              openImageLightbox(created.photo);
            };
          } else {
            const img = document.createElement("img");
            img.className = "w-full h-28 object-cover cursor-pointer";
            bindSmartImage(img, created.photo);
            img.addEventListener("click", function () {
              openImageLightbox(created.photo);
            });
            card.insertBefore(img, card.firstChild);
          }
        } else if (imgEl) {
          imgEl.remove();
        }
      })
      .catch(function (e) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        tempItem.remove();
        document.getElementById("input-ach-title").value = savedTitle;
        document.getElementById("input-ach-date").value = savedDate;
        toast(e.message);
      });
  });

  function updatePinGeoHint() {
    const hint = document.getElementById("pin-geo-hint");
    if (!hint || !navigator.permissions || !navigator.permissions.query) {
      if (hint) hint.classList.add("hidden");
      return;
    }
    navigator.permissions
      .query({ name: "geolocation" })
      .then(function (st) {
        if (st.state === "denied") {
          hint.textContent =
            "Location is blocked for this site. Allow it in browser settings to share a pin (HTTPS may be required).";
          hint.classList.remove("hidden");
        } else if (st.state === "prompt") {
          hint.textContent = "When you tap below, allow location so we can place your pin once.";
          hint.classList.remove("hidden");
        } else {
          hint.classList.add("hidden");
        }
      })
      .catch(function () {
        hint.classList.add("hidden");
      });
  }

  document.getElementById("btn-share-location").addEventListener("click", function () {
    if (!navigator.geolocation) return toast("Geolocation not available");
    const statusEl = document.getElementById("location-status");
    const geoOpts = { enableHighAccuracy: false, maximumAge: 300000, timeout: 20000 };
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        const acc = pos.coords.accuracy;
        toast("Location sent");
        if (statusEl)
          statusEl.textContent =
            "Sharing… " + new Date().toLocaleTimeString() + " · " + lat.toFixed(4) + ", " + lng.toFixed(4);
        api
          .authFetch("/location-share", {
            method: "POST",
            body: {
              coordinates: { type: "Point", coordinates: [lng, lat] },
              accuracy: acc,
            },
          })
          .then(function () {
            if (statusEl)
              statusEl.textContent =
                "Shared at " + new Date().toLocaleTimeString() + " · " + lat.toFixed(4) + ", " + lng.toFixed(4);
            loadPinView();
          })
          .catch(function (e) {
            toast(e.message);
          });
      },
      function (err) {
        let msg = "Could not get location.";
        if (err && err.code === 1) {
          msg = "Permission denied. Allow location for this site in settings (use HTTPS on phone).";
        } else if (err && err.code === 2) {
          msg = "Position unavailable. Try again or move to a spot with better GPS.";
        } else if (err && err.code === 3) {
          msg = "Location request timed out. Try again.";
        }
        if (statusEl) statusEl.textContent = msg;
        toast(msg);
      },
      geoOpts,
    );
  });

  async function loadPinView() {
    const meta = document.getElementById("pin-partner-meta");
    const link = document.getElementById("btn-open-partner-maps");
    const distCard = document.getElementById("pin-distance-card");
    const distText = document.getElementById("pin-distance-text");
    const partnerId = partner() && partner()._id;
    const hideDistance = function () {
      if (distCard) distCard.hidden = true;
    };

    if (!meta) return;
    hideDistance();
    try {
      const json = await api.authFetch("/location-share?limit=30");
      const rows = api.listItems(json);
      const mine = rows.find(function (r) {
        return String(r.userId) === myId();
      });
      const theirs = rows.find(function (r) {
        return partnerId && String(r.userId) === String(partnerId);
      });
      const myCoords = mine && mine.coordinates && mine.coordinates.coordinates;
      const theirCoords = theirs && theirs.coordinates && theirs.coordinates.coordinates;
      if (
        myCoords &&
        theirCoords &&
        myCoords.length >= 2 &&
        theirCoords.length >= 2 &&
        distCard &&
        distText
      ) {
        const lat1 = Number(myCoords[1]);
        const lon1 = Number(myCoords[0]);
        const lat2 = Number(theirCoords[1]);
        const lon2 = Number(theirCoords[0]);
        const km = haversineKm(lat1, lon1, lat2, lon2);
        if (km < 1) distText.textContent = Math.round(km * 1000) + " m apart";
        else distText.textContent = km.toFixed(1) + " km apart";
        distCard.hidden = false;
      }

      if (!theirs || !theirCoords || theirCoords.length < 2) {
        meta.textContent = "Your partner hasn’t shared a pin yet.";
        if (link) link.classList.add("hidden");
        return;
      }
      const lng = Number(theirCoords[0]);
      const lat = Number(theirCoords[1]);
      const when = theirs.updatedAt || theirs.createdAt;
      meta.textContent =
        (when ? "Last updated " + formatTimeAgo(when) : "Shared") + " — opens in Google Maps.";
      if (link) {
        link.href = "https://www.google.com/maps?q=" + encodeURIComponent(String(lat) + "," + String(lng));
        link.classList.remove("hidden");
      }
    } catch (e) {
      meta.textContent = "Could not load your partner’s pin.";
      if (link) link.classList.add("hidden");
      hideDistance();
      toast(e.message || "Pin load failed");
    }
  }

  function normalizeHex(c, fallback) {
    const fb = fallback || "#805062";
    if (!c) return fb;
    const s = String(c).trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s;
    if (/^#[0-9a-f]{3}$/i.test(s))
      return (
        "#" +
        s[1] +
        s[1] +
        s[2] +
        s[2] +
        s[3] +
        s[3]
      ).toLowerCase();
    return fb;
  }

  function buildThemeFields() {
    const keys = ["primary", "secondary", "background", "surface", "text", "textMuted", "accent", "unread"];
    const wrap = document.getElementById("theme-fields");
    wrap.innerHTML = "";
    const c = (session && session.couple && session.couple.theme) || {};
    const fallbacks = {
      primary: "#805062",
      secondary: "#715478",
      background: "#fff8f8",
      surface: "#ffffff",
      text: "#1f1a1c",
      textMuted: "#504447",
      accent: "#805062",
      unread: "#ba1a1a",
    };
    keys.forEach(function (k) {
      const lab = document.createElement("label");
      lab.className = "flex flex-col gap-1";
      lab.innerHTML =
        "<span class='uppercase tracking-wide opacity-70'>" +
        k +
        "</span><input type='color' data-theme-key='" +
        k +
        "' class='h-10 w-full rounded-lg border'/>";
      const input = lab.querySelector("input");
      input.value = normalizeHex(c[k], fallbacks[k]);
      wrap.appendChild(lab);
    });
  }

  document.getElementById("btn-save-name").addEventListener("click", async function () {
    const name = document.getElementById("input-settings-name").value.trim();
    if (!name) return toast("Name required");
    const btn = this;
    try {
      const json = await api.updateMe(name);
      setSessionFromPayload(api.unwrapData(json));
      flashSuccessBtn(btn);
      toast("Name saved");
    } catch (e) {
      toast(e.message);
    }
  });

  document.getElementById("btn-save-theme").addEventListener("click", async function () {
    if (!coupleId()) return toast("Pair first");
    const btn = this;
    const theme = {};
    document.querySelectorAll("#theme-fields [data-theme-key]").forEach(function (inp) {
      theme[inp.getAttribute("data-theme-key")] = inp.value;
    });
    try {
      await api.authFetch("/couple/" + coupleId(), { method: "PUT", body: { theme: theme } });
      await refreshSession();
      buildThemeFields();
      flashSuccessBtn(btn);
      toast("Theme saved");
    } catch (e) {
      toast(e.message);
    }
  });

  document.addEventListener("gifts:tab", function (ev) {
    const t = ev.detail.tab;
    if (t === "home") refreshHome();
    if (t === "love") loadLoveView();
    if (t === "mood") {
      setMoodComposeOpen(false);
      loadMoodPanel();
    }
    if (t === "dreams") loadDreams();
    if (t === "places") {
      loadPlaces();
      setTimeout(function () {
        if (window.GiftsMaps && window.GiftsMaps.invalidate) window.GiftsMaps.invalidate();
      }, 350);
    }
    if (t === "wins") loadAchievements();
    if (t === "pin") {
      updatePinGeoHint();
      loadPinView();
    }
    if (t === "settings") {
      renderHomeHeader();
      document.getElementById("input-settings-name").value = (session && session.user && session.user.name) || "";
      buildThemeFields();
    }
  });

  router.initRouter();

  setInterval(function () {
    tickMoodRelativeLabels();
    renderPartnerMoodPreview();
  }, 5000);

  bootstrap().then(function () {
    if (document.getElementById("app-root").hidden) return;
    if (window.GiftsPlaces && typeof window.GiftsPlaces.init === "function") {
      window.GiftsPlaces.init({
        loadPlaces: loadPlaces,
        insertOptimisticPlaceRow: insertOptimisticPlaceRow,
        confirmOptimisticPlace: confirmOptimisticPlace,
        revertOptimisticPlace: revertOptimisticPlace,
      });
    }
    const tab = router.getInitialTab ? router.getInitialTab() : "home";
    router.setTab(tab);
    if (tab === "home") {
      refreshHome();
    } else {
      loadMoodPreview();
      loadDailyShortcut();
    }
  });
})();
