(function (global) {
  global.GIFTS_CONFIG = {
    API_BASE: "http://slopalyouvy5qa17g3clpvvc.49.12.67.219.sslip.io/api",
    
    /**
     * Maps: Leaflet + free OSM-based tiles and Photon search (see js/maps.js).
     * No Google account, API keys, or billing.
     */
    TOKEN_STORAGE_KEY: "gifts_session_token",
  };
})(typeof window !== "undefined" ? window : globalThis);
