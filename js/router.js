(function (global) {
  const TABS = ["home", "love", "mood", "dreams", "places", "wins", "pin", "settings"];
  const TAB_STORAGE_KEY = "gifts:activeTab";

  function getInitialTab() {
    try {
      const t = sessionStorage.getItem(TAB_STORAGE_KEY);
      if (t && TABS.includes(t)) return t;
    } catch (e) {
      /* ignore */
    }
    return "home";
  }

  function setTab(name) {
    if (!TABS.includes(name)) name = "home";
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, name);
    } catch (e) {
      /* ignore */
    }
    for (const t of TABS) {
      const panel = document.getElementById("view-" + t);
      const btn = document.querySelector('#bottom-nav [data-tab="' + t + '"]');
      if (panel) panel.hidden = t !== name;
      if (btn) {
        const active = t === name;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
      }
    }
    const evt = new CustomEvent("gifts:tab", { detail: { tab: name } });
    document.dispatchEvent(evt);
    const activeBtn = document.querySelector('#bottom-nav [data-tab="' + name + '"]');
    if (activeBtn && typeof activeBtn.scrollIntoView === "function") {
      activeBtn.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }
  }

  function initRouter() {
    document.querySelectorAll("#bottom-nav [data-tab]").forEach((btn) => {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        setTab(this.getAttribute("data-tab"));
      });
    });
  }

  global.GiftsRouter = { setTab, initRouter, TABS, getInitialTab };
})(typeof window !== "undefined" ? window : globalThis);
