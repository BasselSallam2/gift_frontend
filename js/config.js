(function (global) {
  global.GIFTS_CONFIG = {
    API_BASE: "https://t1bnvv93-3000.euw.devtunnels.ms/api",
    /**
     * Maps: Leaflet + free OSM-based tiles and Photon search (see js/maps.js).
     * No Google account, API keys, or billing.
     */
    TOKEN_STORAGE_KEY: "gifts_session_token",
  };
})(typeof window !== "undefined" ? window : globalThis);
