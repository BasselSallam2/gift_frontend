(function (global) {
  let loadPlacesCb = function () {};
  let searchDebounceTimer = null;

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

  function sheetShow(visible) {
    const s = document.getElementById("place-add-sheet");
    if (s) s.hidden = !visible;
  }

  function suggestionsHide() {
    const box = document.getElementById("place-search-suggestions");
    if (box) {
      box.innerHTML = "";
      box.classList.add("hidden");
    }
  }

  function suggestionsShow(rows, onPick) {
    const box = document.getElementById("place-search-suggestions");
    if (!box) return;
    box.innerHTML = "";
    if (!rows.length) {
      box.classList.add("hidden");
      return;
    }
    rows.forEach(function (r) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = r.label;
      b.addEventListener("click", function () {
        suggestionsHide();
        onPick(r);
      });
      box.appendChild(b);
    });
    box.classList.remove("hidden");
  }

  function runPlaceSearchAndPick(q) {
    if (!global.GiftsMaps) return;
    const query = (q || "").trim();
    if (!query) return toast("Enter a place to search");
    global.GiftsMaps.searchPhoton(query)
      .then(function (r) {
        global.GiftsMaps.flyTo(r.lat, r.lng, 14);
        global.GiftsMaps.stopPickMode();
        global.GiftsMaps.startPickMode(function () {
          sheetShow(true);
        });
        toast("Tap the map to drop your pin");
      })
      .catch(function (e) {
        toast(e.message || "Search failed");
      });
  }

  function init(opts) {
    if (opts && typeof opts.loadPlaces === "function") loadPlacesCb = opts.loadPlaces;
    const insertOptimisticPlaceRow = opts && opts.insertOptimisticPlaceRow;
    const confirmOptimisticPlace = opts && opts.confirmOptimisticPlace;
    const revertOptimisticPlace = opts && opts.revertOptimisticPlace;
    const searchBtn = document.getElementById("btn-place-search");
    const searchInp = document.getElementById("input-place-search");
    const locateBtn = document.getElementById("btn-place-my-location");
    if (!searchInp || !global.GiftsMaps) return;

    if (searchBtn) {
      searchBtn.addEventListener("click", function () {
        suggestionsHide();
        runPlaceSearchAndPick(searchInp.value);
      });
    }

    searchInp.addEventListener("input", function () {
      const q = searchInp.value.trim();
      clearTimeout(searchDebounceTimer);
      if (q.length < 2) {
        suggestionsHide();
        return;
      }
      searchDebounceTimer = setTimeout(async function () {
        try {
          const list = await global.GiftsMaps.searchPhotonMany(q, 5);
          suggestionsShow(list, function (r) {
            global.GiftsMaps.flyTo(r.lat, r.lng, 14);
            global.GiftsMaps.stopPickMode();
            global.GiftsMaps.startPickMode(function () {
              sheetShow(true);
            });
            toast("Tap the map to drop your pin");
          });
        } catch (e) {
          suggestionsHide();
        }
      }, 350);
    });

    searchInp.addEventListener("blur", function () {
      setTimeout(suggestionsHide, 200);
    });

    if (locateBtn) {
      locateBtn.addEventListener("click", function () {
        if (!navigator.geolocation) return toast("Geolocation not available");
        suggestionsHide();
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            global.GiftsMaps.flyTo(pos.coords.latitude, pos.coords.longitude, 15);
            toast("Map moved to your location");
          },
          function () {
            toast("Location permission denied");
          },
        );
      });
    }

    const cancelBtn = document.getElementById("btn-place-sheet-cancel");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        sheetShow(false);
        const nameInp = document.getElementById("input-place-sheet-name");
        const dateInp = document.getElementById("input-place-sheet-date");
        const ph = document.getElementById("input-place-sheet-photo");
        if (nameInp) nameInp.value = "";
        if (dateInp) dateInp.value = "";
        if (ph) ph.value = "";
        global.GiftsMaps.stopPickMode();
      });
    }

    const backdrop = document.getElementById("place-add-sheet-backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", function () {
        if (cancelBtn) cancelBtn.click();
      });
    }

    const saveBtn = document.getElementById("btn-place-sheet-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        if (!global.GiftsMaps || !global.GiftsApi) return;
        const ll = global.GiftsMaps.getPickLatLng && global.GiftsMaps.getPickLatLng();
        if (!ll) return toast("Tap the map to set a pin first");
        const nameEl = document.getElementById("input-place-sheet-name");
        const name = nameEl ? nameEl.value.trim() : "";
        const dateEl = document.getElementById("input-place-sheet-date");
        const visitDate = dateEl ? dateEl.value : "";
        if (!name) return toast("Place name required");
        const pfEl = document.getElementById("input-place-sheet-photo");
        const pf = pfEl && pfEl.files && pfEl.files[0];
        const tempId = "_tmp_place_" + Date.now();
        const partial = {
          _id: tempId,
          name: name,
          visitDate: visitDate || undefined,
          location: { type: "Point", coordinates: [ll.lng, ll.lat] },
        };
        if (typeof insertOptimisticPlaceRow === "function") insertOptimisticPlaceRow(partial);
        if (pfEl) pfEl.value = "";
        if (nameEl) nameEl.value = "";
        if (dateEl) dateEl.value = "";
        sheetShow(false);
        global.GiftsMaps.stopPickMode();
        toast("Place saved");

        const uploadP = pf ? global.GiftsApi.uploadFile(pf) : Promise.resolve(null);
        uploadP
          .then(function (imageUrl) {
            return global.GiftsApi.authFetch("/shared-place", {
              method: "POST",
              body: {
                name: name,
                visitDate: visitDate || undefined,
                imageUrl: imageUrl || undefined,
                location: { type: "Point", coordinates: [ll.lng, ll.lat] },
              },
            });
          })
          .then(function (json) {
            const created = global.GiftsApi.unwrapData(json);
            if (typeof confirmOptimisticPlace === "function" && created) {
              confirmOptimisticPlace(tempId, created);
            } else {
              loadPlacesCb();
            }
          })
          .catch(function (e) {
            if (typeof revertOptimisticPlace === "function") revertOptimisticPlace(tempId);
            toast(e.message || "Save failed");
          });
      });
    }
  }

  global.GiftsPlaces = { init: init };
})(typeof window !== "undefined" ? window : globalThis);
