(function (global) {
  const KEYS = ["primary", "secondary", "background", "surface", "text", "textMuted", "accent", "unread"];

  function applyThemeFromCouple(couple) {
    const theme = couple && couple.theme ? couple.theme : {};
    const root = document.documentElement;
    const map = {
      primary: theme.primary,
      secondary: theme.secondary,
      background: theme.background,
      surface: theme.surface,
      text: theme.text,
      textMuted: theme.textMuted,
      accent: theme.accent,
      unread: theme.unread,
    };
    for (const [k, v] of Object.entries(map)) {
      if (v && typeof v === "string") root.style.setProperty("--color-" + (k === "textMuted" ? "text-muted" : k), v);
    }
    if (theme.background) document.body.style.backgroundColor = theme.background;
  }

  global.applyThemeFromCouple = applyThemeFromCouple;
})(typeof window !== "undefined" ? window : globalThis);
