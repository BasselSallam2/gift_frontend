(function (global) {
  let map = null;
  let savedMarkersLayer = null;
  let provisionalMarker = null;
  let pickHandler = null;

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function placeImageUrl(key) {
    if (key == null) return "";
    if (typeof key === "object" && key && typeof key.key === "string") return placeImageUrl(key.key);
    const s = String(key).trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    const api = global.GiftsApi;
    if (api && typeof api.streamUrlFromStorageKey === "function") return api.streamUrlFromStorageKey(s);
    return "";
  }

  function onMapClick(e) {
    if (!pickHandler || !map) return;
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    if (provisionalMarker) {
      provisionalMarker.setLatLng([lat, lng]);
    } else {
      provisionalMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
      provisionalMarker.on("dragend", function () {
        const ll = provisionalMarker.getLatLng();
        pickHandler(ll.lat, ll.lng);
      });
    }
    pickHandler(lat, lng);
  }

  function ensureMap() {
    if (typeof L === "undefined") return;
    const el = document.getElementById("place-map");
    if (!el || map) return;
    map = L.map("place-map", {
      scrollWheelZoom: false,
      attributionControl: true,
    }).setView([20, 0], 2);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
    }).addTo(map);
    savedMarkersLayer = L.layerGroup().addTo(map);
    map.on("click", onMapClick);
    invalidate();
  }

  function invalidate() {
    if (!map) return;
    map.invalidateSize();
  }

  /** Saved places only — does not remove pick / provisional marker. */
  function syncPlaces(places) {
    if (typeof L === "undefined") return;
    ensureMap();
    if (!map || !savedMarkersLayer) return;
    savedMarkersLayer.clearLayers();
    const latLngs = [];
    (places || []).forEach(function (p) {
      const loc = p.location && p.location.coordinates;
      if (!loc || loc.length < 2) return;
      const lng = Number(loc[0]);
      const lat = Number(loc[1]);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return;
      latLngs.push([lat, lng]);
      const marker = L.marker([lat, lng]);
      const wrap = document.createElement("div");
      wrap.className = "place-marker-popup text-[13px] max-w-[200px]";
      const title = document.createElement("div");
      title.className = "font-semibold text-on-surface";
      title.textContent = p.name || "Place";
      wrap.appendChild(title);
      if (p.visitDate) {
        const dt = document.createElement("div");
        dt.className = "text-xs opacity-75 mt-0.5";
        dt.textContent = new Date(p.visitDate).toLocaleDateString();
        wrap.appendChild(dt);
      }
      if (p.imageUrl) {
        const src = placeImageUrl(p.imageUrl);
        if (src) {
          const img = document.createElement("img");
          img.src = src;
          img.alt = "";
          img.className = "mt-2 rounded-lg max-w-[180px] max-h-[120px] object-cover";
          wrap.appendChild(img);
        }
      }
      marker.bindPopup(wrap);
      marker.addTo(savedMarkersLayer);
    });
    if (latLngs.length === 1) {
      map.setView(latLngs[0], 13);
    } else if (latLngs.length > 1) {
      map.fitBounds(latLngs, { padding: [28, 28], maxZoom: 14 });
    }
    invalidate();
  }

  function flyTo(lat, lng, zoom) {
    ensureMap();
    if (!map) return;
    map.setView([lat, lng], zoom != null ? zoom : 13);
    invalidate();
  }

  function featureToResult(f, fallbackLabel) {
    if (!f || !f.geometry || !f.geometry.coordinates) return null;
    const lng = f.geometry.coordinates[0];
    const lat = f.geometry.coordinates[1];
    const props = f.properties || {};
    const label =
      [props.name, props.street, props.city, props.country].filter(Boolean).join(", ") ||
      props.name ||
      props.street ||
      props.city ||
      props.country ||
      fallbackLabel;
    return { lat, lng, label: label || fallbackLabel };
  }

  /**
   * Photon (Komoot) — OpenStreetMap-based search, no API key.
   */
  async function searchPhotonMany(query, limit) {
    const q = (query || "").trim();
    if (!q) return [];
    const lim = Math.min(Math.max(limit || 5, 1), 10);
    const url = "https://photon.komoot.io/api/?q=" + encodeURIComponent(q) + "&limit=" + lim;
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error("Search failed");
    const data = await res.json();
    const feats = data.features || [];
    const out = [];
    for (let i = 0; i < feats.length; i++) {
      const r = featureToResult(feats[i], q);
      if (r) out.push(r);
    }
    return out;
  }

  async function searchPhoton(query) {
    const list = await searchPhotonMany(query, 1);
    if (!list.length) throw new Error("No results — try a different name");
    return list[0];
  }

  function startPickMode(onPick) {
    ensureMap();
    pickHandler = onPick;
    if (map && map.getContainer()) map.getContainer().classList.add("map-picking");
  }

  function stopPickMode() {
    pickHandler = null;
    if (map && map.getContainer()) map.getContainer().classList.remove("map-picking");
    if (provisionalMarker && map) {
      map.removeLayer(provisionalMarker);
      provisionalMarker = null;
    }
  }

  function getPickLatLng() {
    if (!provisionalMarker) return null;
    const ll = provisionalMarker.getLatLng();
    return { lat: ll.lat, lng: ll.lng };
  }

  global.GiftsMaps = {
    ensureMap,
    syncPlaces,
    invalidate,
    flyTo,
    searchPhoton,
    searchPhotonMany,
    startPickMode,
    stopPickMode,
    getPickLatLng,
    esc,
    placeImageUrl,
  };
})(typeof window !== "undefined" ? window : globalThis);
