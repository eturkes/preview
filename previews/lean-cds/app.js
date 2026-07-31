/* Canonical offline dashboard runtime. Content stays declarative and pre-rendered. */
(function () {
  "use strict";

  const root = document.documentElement;
  const projectNode = document.querySelector("[data-preview-project]");
  const projectKey = encodeURIComponent(
    projectNode && projectNode.dataset.previewProject ? projectNode.dataset.previewProject : "unknown"
  );
  const storageKeys = {
    locale: "preview.locale",
    view: "preview.v1." + projectKey + ".view",
    demo: "preview.v1." + projectKey + ".demo"
  };
  const supportedLocales = ["ja", "en"];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const announcer = document.querySelector("[data-preview-announcer]");

  function readStorage(key) {
    try { return window.localStorage.getItem(key); } catch (_error) { return null; }
  }

  function writeStorage(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (_error) {
      /* Opaque file origins can deny storage; URL + in-memory state still work. */
    }
  }

  function currentUrl() {
    try { return new URL(window.location.href); } catch (_error) { return null; }
  }

  function queryValue(name) {
    const url = currentUrl();
    return url ? url.searchParams.get(name) : null;
  }

  function replaceQuery(name, value) {
    const url = currentUrl();
    if (!url) return;
    if (value === null || value === "") url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    try { window.history.replaceState(null, "", url.href); } catch (_error) { /* file URL fallback */ }
  }

  function elementsWithValue(attribute, value, scope) {
    const context = scope || document;
    return Array.from(context.querySelectorAll("[" + attribute + "]"))
      .filter((element) => element.getAttribute(attribute) === value);
  }

  function firstWithValue(attribute, value, scope) {
    return elementsWithValue(attribute, value, scope)[0] || null;
  }

  function announce(ja, en) {
    if (!announcer) return;
    announcer.textContent = "";
    window.requestAnimationFrame(function () {
      announcer.textContent = state.locale === "ja" ? ja : en;
    });
  }

  const state = {
    locale: "ja",
    view: "",
    demo: "",
    evidence: ""
  };

  /* Locale --------------------------------------------------------------- */
  const localeButtons = Array.from(document.querySelectorAll("[data-locale-target]"));

  function validLocale(value) {
    return supportedLocales.includes(value) ? value : null;
  }

  function setLocale(locale, options) {
    const settings = Object.assign({ persist: true, updateUrl: true, announce: false }, options);
    const next = validLocale(locale) || "ja";
    state.locale = next;
    root.lang = next;
    root.dataset.locale = next;
    localeButtons.forEach(function (button) {
      const active = button.dataset.localeTarget === next;
      button.setAttribute("aria-pressed", String(active));
      if (active) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
    if (settings.persist) writeStorage(storageKeys.locale, next);
    if (settings.updateUrl) {
      replaceQuery("lang", next);
      replaceQuery("locale", null);
    }
    if (tour.active) renderTourStep();
    if (settings.announce) {
      announce("表示言語を日本語に変更しました。", "Display language changed to English.");
    }
    document.dispatchEvent(new CustomEvent("preview:locale", { detail: { locale: next } }));
  }

  localeButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      setLocale(button.dataset.localeTarget, { announce: true });
    });
  });

  /* Example views -------------------------------------------------------- */
  const viewPanels = Array.from(document.querySelectorAll("[data-view]"));
  const viewLinks = Array.from(document.querySelectorAll("[data-view-target]"));
  const compactViewLayout = window.matchMedia("(max-width: 52rem)");

  function syncViewOrientation() {
    document.querySelectorAll(".example-nav[role='tablist']").forEach(function (tablist) {
      tablist.setAttribute("aria-orientation", compactViewLayout.matches ? "horizontal" : "vertical");
    });
  }

  syncViewOrientation();
  compactViewLayout.addEventListener("change", syncViewOrientation);

  function viewExists(key) {
    return viewPanels.some((panel) => panel.dataset.view === key);
  }

  function selectView(key, options) {
    const settings = Object.assign({ persist: true, updateUrl: true, announce: false }, options);
    const fallback = viewPanels[0] ? viewPanels[0].dataset.view : "";
    const next = viewExists(key) ? key : fallback;
    if (!next) return false;
    state.view = next;
    viewPanels.forEach(function (panel) {
      const active = panel.dataset.view === next;
      panel.hidden = !active;
      panel.setAttribute("aria-hidden", String(!active));
    });
    viewLinks.forEach(function (link) {
      const active = link.dataset.viewTarget === next;
      link.classList.toggle("is-active", active);
      link.setAttribute("aria-selected", String(active));
      link.tabIndex = active ? 0 : -1;
    });
    if (settings.persist) writeStorage(storageKeys.view, next);
    if (settings.updateUrl) {
      replaceQuery("example", next);
      replaceQuery("view", null);
    }
    if (settings.announce) {
      announce("ビューを切り替えました。", "View changed.");
    }
    document.dispatchEvent(new CustomEvent("preview:view", { detail: { view: next } }));
    return true;
  }

  function activateRelativeView(link, event) {
    const tablist = link.closest("[role='tablist']") || link.parentElement;
    const links = viewLinks.filter((candidate) => candidate.closest("[role='tablist']") === tablist ||
      (!candidate.closest("[role='tablist']") && candidate.parentElement === tablist));
    if (!links.length) return;
    const vertical = tablist && tablist.getAttribute("aria-orientation") === "vertical";
    const previousKey = vertical ? "ArrowUp" : "ArrowLeft";
    const nextKey = vertical ? "ArrowDown" : "ArrowRight";
    let index = links.indexOf(link);
    if (event.key === previousKey) index = (index - 1 + links.length) % links.length;
    else if (event.key === nextKey) index = (index + 1) % links.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = links.length - 1;
    else return;
    event.preventDefault();
    links[index].focus();
    selectView(links[index].dataset.viewTarget, { announce: true });
  }

  viewLinks.forEach(function (link) {
    link.addEventListener("click", function (event) {
      event.preventDefault();
      selectView(link.dataset.viewTarget, { announce: true });
    });
    link.addEventListener("keydown", function (event) {
      activateRelativeView(link, event);
    });
  });

  /* Declarative demos ---------------------------------------------------- */
  const demoTriggers = Array.from(document.querySelectorAll("[data-demo-trigger]"));
  const demoResults = Array.from(document.querySelectorAll("[data-demo-result]"));
  let demoTimer = null;

  function demoRunningNodes(key) {
    const nodes = [];
    elementsWithValue("data-demo-trigger", key).forEach(function (trigger) {
      const component = trigger.closest("[data-component]");
      if (component) nodes.push(...component.querySelectorAll("[data-demo-running]"));
    });
    return nodes;
  }

  function resetDemos(options) {
    const settings = Object.assign({ persist: true, updateUrl: true }, options);
    if (demoTimer !== null) window.clearTimeout(demoTimer);
    demoTimer = null;
    demoResults.forEach(function (result) {
      result.hidden = true;
      result.classList.remove("is-revealed");
    });
    document.querySelectorAll("[data-demo-running]").forEach(function (running) {
      running.hidden = true;
    });
    demoTriggers.forEach(function (trigger) {
      trigger.disabled = false;
      trigger.setAttribute("aria-expanded", "false");
      trigger.classList.remove("is-active");
    });
    state.demo = "";
    if (settings.persist) writeStorage(storageKeys.demo, null);
    if (settings.updateUrl) replaceQuery("demo", null);
  }

  function finishDemo(key, results, settings) {
    demoRunningNodes(key).forEach(function (running) { running.hidden = true; });
    results.forEach(function (result) {
      result.hidden = false;
      result.classList.add("is-revealed");
    });
    elementsWithValue("data-demo-trigger", key).forEach(function (trigger) {
      trigger.disabled = false;
      trigger.setAttribute("aria-expanded", "true");
      trigger.classList.add("is-active");
    });
    demoTimer = null;
    if (settings.announce) announce("実行結果を表示しました。", "Demo result shown.");
    document.dispatchEvent(new CustomEvent("preview:demo", { detail: { demo: key } }));
  }

  function runDemo(key, options) {
    const settings = Object.assign(
      { persist: true, updateUrl: true, announce: true, delay: true },
      options
    );
    const results = elementsWithValue("data-demo-result", key);
    if (!key || !results.length) return false;
    resetDemos({ persist: false, updateUrl: false });
    const ownerView = results[0].closest("[data-view]");
    if (ownerView) selectView(ownerView.dataset.view, settings);
    elementsWithValue("data-demo-trigger", key).forEach(function (trigger) {
      trigger.disabled = settings.delay && !reducedMotion.matches;
    });
    state.demo = key;
    if (settings.persist) writeStorage(storageKeys.demo, key);
    if (settings.updateUrl) replaceQuery("demo", key);
    if (settings.delay && !reducedMotion.matches) {
      demoRunningNodes(key).forEach(function (running) { running.hidden = false; });
      demoTimer = window.setTimeout(function () { finishDemo(key, results, settings); }, 260);
    } else {
      finishDemo(key, results, settings);
    }
    return true;
  }

  demoTriggers.forEach(function (trigger) {
    trigger.addEventListener("click", function () {
      runDemo(trigger.dataset.demoTrigger);
    });
  });
  document.querySelectorAll("[data-demo-reset]").forEach(function (trigger) {
    trigger.addEventListener("click", function () { resetDemos(); });
  });

  function revealKey(key) {
    if (!key) return;
    if (runDemo(key, { persist: false, updateUrl: false, announce: false, delay: false })) return;
    elementsWithValue("data-reveal", key).forEach(function (element) {
      element.hidden = false;
      if (element.tagName === "DETAILS") element.open = true;
    });
  }

  /* Optional nested tabs ------------------------------------------------- */
  function selectTab(tab, announceChange) {
    const group = tab.closest("[data-tabs]") || tab.parentElement.parentElement;
    const key = tab.dataset.tabTarget;
    const tabs = Array.from(group.querySelectorAll("[data-tab-target]"));
    const panels = Array.from(group.querySelectorAll("[data-tab-panel]"));
    tabs.forEach(function (candidate) {
      const active = candidate.dataset.tabTarget === key;
      candidate.setAttribute("aria-selected", String(active));
      candidate.tabIndex = active ? 0 : -1;
    });
    panels.forEach(function (panel) { panel.hidden = panel.dataset.tabPanel !== key; });
    if (announceChange) announce("タブを切り替えました。", "Tab changed.");
  }

  document.querySelectorAll("[data-tab-target]").forEach(function (tab) {
    tab.addEventListener("click", function () { selectTab(tab, true); });
    tab.addEventListener("keydown", function (event) {
      const list = tab.closest("[role='tablist']") || tab.parentElement;
      const tabs = Array.from(list.querySelectorAll("[data-tab-target]"));
      const vertical = list.getAttribute("aria-orientation") === "vertical";
      const backward = vertical ? "ArrowUp" : "ArrowLeft";
      const forward = vertical ? "ArrowDown" : "ArrowRight";
      let index = tabs.indexOf(tab);
      if (event.key === backward) index = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === forward) index = (index + 1) % tabs.length;
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = tabs.length - 1;
      else return;
      event.preventDefault();
      tabs[index].focus();
      selectTab(tabs[index], true);
    });
  });

  /* Evidence review ------------------------------------------------------ */
  const evidenceNodes = {
    layer: document.querySelector("[data-evidence-layer]"),
    drawer: document.querySelector("[data-evidence-drawer]"),
    rows: Array.from(document.querySelectorAll("[data-evidence-select]")),
    details: Array.from(document.querySelectorAll("[data-evidence-detail]")),
    filters: Array.from(document.querySelectorAll("[data-evidence-filter]")),
    filterEmpty: document.querySelector("[data-evidence-filter-empty]"),
    review: document.querySelector(".evidence-review")
  };
  const compactEvidenceLayout = window.matchMedia("(max-width: 52rem)");
  const evidence = {
    active: false,
    launcher: null
  };

  function evidenceExists(key) {
    return evidenceNodes.rows.some(function (row) { return row.dataset.evidenceSelect === key; });
  }

  function rendered(element) {
    if (!element || element.hidden || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function dialogFocusables(scope) {
    if (!scope) return [];
    return Array.from(scope.querySelectorAll(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), " +
      "textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    )).filter(rendered);
  }

  function visibleEvidenceRows() {
    return evidenceNodes.rows.filter(function (row) { return !row.hidden; });
  }

  function scrollEvidenceDetail(key) {
    const detail = evidenceNodes.details.find(function (candidate) {
      return candidate.dataset.evidenceDetail === key;
    });
    if (compactEvidenceLayout.matches && evidenceNodes.review && detail) {
      evidenceNodes.review.scrollIntoView({
        block: "start",
        behavior: "auto"
      });
    } else if (evidenceNodes.review) {
      evidenceNodes.review.scrollTo({
        top: 0,
        behavior: "auto"
      });
    }
  }

  function focusEvidenceDetail(key) {
    const detail = evidenceNodes.details.find(function (candidate) {
      return candidate.dataset.evidenceDetail === key;
    });
    if (detail) detail.focus({ preventScroll: true });
  }

  function evidenceClaim(key) {
    const detail = evidenceNodes.details.find(function (candidate) {
      return candidate.dataset.evidenceDetail === key;
    });
    const claim = detail && detail.querySelector(
      ".evidence-detail__claim > [lang='" + state.locale + "']"
    );
    return claim ? claim.textContent.trim() : key;
  }

  function selectEvidence(key, options) {
    const settings = Object.assign(
      { updateUrl: evidence.active, announce: false, scroll: false },
      options
    );
    if (!evidenceExists(key)) return false;
    state.evidence = key;
    evidenceNodes.rows.forEach(function (row) {
      row.setAttribute("aria-pressed", String(row.dataset.evidenceSelect === key));
    });
    evidenceNodes.details.forEach(function (detail) {
      detail.hidden = detail.dataset.evidenceDetail !== key;
    });
    if (settings.scroll) scrollEvidenceDetail(key);
    if (settings.updateUrl) replaceQuery("claim", key);
    if (settings.announce) {
      const claim = evidenceClaim(key);
      announce("根拠の詳細：" + claim, "Evidence detail: " + claim);
    }
    document.dispatchEvent(new CustomEvent("preview:evidence", { detail: { claim: key } }));
    return true;
  }

  function filterEvidence(status, options) {
    const settings = Object.assign(
      { updateUrl: evidence.active, announce: false },
      options
    );
    const allowed = ["all", "verified", "inferred", "gap"];
    const next = allowed.includes(status) ? status : "all";
    evidenceNodes.filters.forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.evidenceFilter === next));
    });
    evidenceNodes.rows.forEach(function (row) {
      row.hidden = next !== "all" && row.dataset.provenanceStatus !== next;
    });
    const visible = visibleEvidenceRows();
    if (evidenceNodes.filterEmpty) evidenceNodes.filterEmpty.hidden = visible.length > 0;
    const selectedVisible = visible.some(function (row) {
      return row.dataset.evidenceSelect === state.evidence;
    });
    if (!visible.length) {
      state.evidence = "";
      evidenceNodes.rows.forEach(function (row) { row.setAttribute("aria-pressed", "false"); });
      evidenceNodes.details.forEach(function (detail) { detail.hidden = true; });
      if (settings.updateUrl) replaceQuery("claim", null);
    } else if (!selectedVisible) {
      selectEvidence(visible[0].dataset.evidenceSelect, {
        updateUrl: settings.updateUrl,
        announce: false
      });
    }
    if (settings.announce) {
      const count = visible.length;
      announce(
        count ? String(count) + "件の根拠。" + (!selectedVisible ? "先頭の結果を選択しました。" : "") :
          "一致する根拠はありません。",
        count ? String(count) + (count === 1 ? " evidence entry. " : " evidence entries. ") +
          (!selectedVisible ? "First result selected." : "") : "No evidence entries match."
      );
    }
  }

  function closeEvidence(options) {
    const settings = Object.assign({ returnFocus: true, updateUrl: true }, options);
    if (!evidence.active) return;
    evidence.active = false;
    if (evidenceNodes.layer) evidenceNodes.layer.hidden = true;
    document.body.classList.remove("evidence-open");
    const appShell = document.querySelector(".app-shell");
    if (appShell) appShell.inert = false;
    if (settings.updateUrl) replaceQuery("claim", null);
    const returnTarget = evidence.launcher;
    evidence.launcher = null;
    if (
      settings.returnFocus && returnTarget && returnTarget.isConnected &&
      typeof returnTarget.focus === "function"
    ) {
      returnTarget.focus({ preventScroll: true });
    }
  }

  function openEvidence(key, launcher, options) {
    const settings = Object.assign({ updateUrl: true, announce: true }, options);
    if (!evidenceNodes.layer || !evidenceNodes.drawer || !evidenceNodes.rows.length) {
      announce("このプレビューには根拠台帳がありません。", "This preview has no evidence ledger.");
      return false;
    }
    if (key && !evidenceExists(key)) return false;
    if (tour.active) closeTour();
    evidence.launcher = launcher || document.activeElement || document.querySelector("[data-evidence-launch]");
    evidence.active = true;
    evidenceNodes.layer.hidden = false;
    document.body.classList.add("evidence-open");
    const appShell = document.querySelector(".app-shell");
    if (appShell) appShell.inert = true;
    filterEvidence("all", { updateUrl: false });
    const visible = visibleEvidenceRows();
    const next = key || (evidenceExists(state.evidence) ? state.evidence : "") ||
      (visible[0] ? visible[0].dataset.evidenceSelect : "");
    if (next) {
      selectEvidence(next, {
        updateUrl: settings.updateUrl,
        announce: false,
        scroll: false
      });
    }
    if (settings.announce) {
      const claim = key && next ? evidenceClaim(next) : "";
      announce(
        claim ? "根拠レビューを開きました：" + claim : "根拠レビューを開きました。",
        claim ? "Evidence review opened: " + claim : "Evidence review opened."
      );
    }
    if (key && next) {
      window.requestAnimationFrame(function () {
        if (!evidence.active || state.evidence !== next) return;
        scrollEvidenceDetail(next);
        focusEvidenceDetail(next);
      });
    } else {
      evidenceNodes.drawer.focus({ preventScroll: true });
    }
    return true;
  }

  document.querySelectorAll("[data-evidence-open]").forEach(function (button) {
    button.addEventListener("click", function () {
      openEvidence(button.dataset.evidenceOpen, button);
    });
  });
  document.querySelectorAll("[data-evidence-launch]").forEach(function (button) {
    button.addEventListener("click", function () { openEvidence("", button); });
  });
  evidenceNodes.rows.forEach(function (row) {
    row.addEventListener("click", function () {
      selectEvidence(row.dataset.evidenceSelect, { announce: true, scroll: true });
      focusEvidenceDetail(row.dataset.evidenceSelect);
    });
  });
  evidenceNodes.filters.forEach(function (button) {
    button.addEventListener("click", function () {
      filterEvidence(button.dataset.evidenceFilter, { announce: true });
    });
  });
  document.querySelectorAll("[data-evidence-close], [data-evidence-dismiss]").forEach(function (node) {
    node.addEventListener("click", function () { closeEvidence(); });
  });

  document.addEventListener("keydown", function (event) {
    if (!evidence.active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeEvidence();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = dialogFocusables(evidenceNodes.drawer);
    if (!focusables.length) {
      event.preventDefault();
      evidenceNodes.drawer.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement.matches("[data-evidence-detail]")) {
      const selectedRow = evidenceNodes.rows.find(function (row) {
        return row.dataset.evidenceSelect === state.evidence;
      });
      if (selectedRow && rendered(selectedRow)) {
        event.preventDefault();
        selectedRow.focus();
      }
    } else if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === evidenceNodes.drawer)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  /* Guided tour ---------------------------------------------------------- */
  function parseTour() {
    const source = document.getElementById("preview-tour");
    if (!source) return { version: 1, controls: {}, steps: [] };
    try {
      const parsed = JSON.parse(source.textContent);
      return {
        version: parsed.version || 1,
        controls: parsed.controls && typeof parsed.controls === "object" ? parsed.controls : {},
        steps: Array.isArray(parsed.steps) ? parsed.steps.filter((step) => step && typeof step === "object") : []
      };
    } catch (_error) {
      return { version: 1, controls: {}, steps: [] };
    }
  }

  const tourConfig = parseTour();
  const tourNodes = {
    layer: document.querySelector("[data-tour-layer]"),
    card: document.querySelector("[data-tour-card]"),
    title: document.querySelector("[data-tour-title]"),
    body: document.querySelector("[data-tour-body]"),
    progress: document.querySelector("[data-tour-progress]"),
    missing: document.querySelector("[data-tour-missing]"),
    highlight: document.querySelector("[data-tour-highlight]"),
    back: document.querySelector("[data-tour-back]"),
    next: document.querySelector("[data-tour-next]"),
    nextLabel: document.querySelector("[data-tour-control='next']"),
    doneLabel: document.querySelector("[data-tour-control='done']")
  };
  const tour = {
    active: false,
    index: 0,
    launcher: null,
    target: null,
    priorDemo: "",
    priorView: ""
  };

  function localized(value) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    return typeof value[state.locale] === "string" ? value[state.locale] :
      (typeof value.en === "string" ? value.en : (typeof value.ja === "string" ? value.ja : ""));
  }

  function applyTourControls() {
    ["next", "back", "done", "close"].forEach(function (name) {
      const values = tourConfig.controls[name];
      if (!values || typeof values !== "object") return;
      document.querySelectorAll("[data-tour-control='" + name + "'] > [lang]").forEach(function (node) {
        const value = values[node.lang];
        if (typeof value === "string" && value) node.textContent = value;
      });
    });
  }

  function resolveTourTarget(reference) {
    if (!reference || typeof reference !== "string") return null;
    return firstWithValue("data-tour", reference);
  }

  function clearTourTarget() {
    if (tour.target) tour.target.classList.remove("is-tour-target");
    tour.target = null;
    if (tourNodes.layer) tourNodes.layer.classList.remove("has-target");
    if (tourNodes.highlight) tourNodes.highlight.hidden = true;
  }

  function positionTourHighlight() {
    if (!tour.active || !tour.target || !tourNodes.highlight || !tourNodes.layer) return;
    const bounds = tour.target.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      tourNodes.highlight.hidden = true;
      tourNodes.layer.classList.remove("has-target");
      return;
    }
    const padding = 6;
    tourNodes.highlight.style.top = String(bounds.top - padding) + "px";
    tourNodes.highlight.style.left = String(bounds.left - padding) + "px";
    tourNodes.highlight.style.width = String(bounds.width + (padding * 2)) + "px";
    tourNodes.highlight.style.height = String(bounds.height + (padding * 2)) + "px";
    tourNodes.highlight.hidden = false;
    tourNodes.layer.classList.add("has-target");
  }

  function replayTourReveals() {
    resetDemos({ persist: false, updateUrl: false });
    tourConfig.steps.slice(0, tour.index + 1).forEach(function (priorStep) {
      if (typeof priorStep.reveal === "string" && priorStep.reveal) {
        revealKey(priorStep.reveal);
      }
    });
  }

  function renderTourStep() {
    if (!tour.active || !tourConfig.steps.length || !tourNodes.card) return;
    const step = tourConfig.steps[tour.index];
    replayTourReveals();
    if (typeof step.view === "string" && step.view) {
      selectView(step.view, { persist: false, updateUrl: false, announce: false });
    }
    clearTourTarget();
    tour.target = resolveTourTarget(step.target);
    if (tour.target) {
      tour.target.classList.add("is-tour-target");
      tour.target.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: reducedMotion.matches ? "auto" : "smooth"
      });
      positionTourHighlight();
      window.requestAnimationFrame(positionTourHighlight);
    }
    tourNodes.card.classList.toggle("is-anchored", Boolean(tour.target));
    tourNodes.card.dataset.step = typeof step.id === "string" ? step.id : String(tour.index + 1);
    tourNodes.title.textContent = localized(step.title);
    tourNodes.body.textContent = localized(step.body);
    tourNodes.progress.textContent = String(tour.index + 1) + " / " + String(tourConfig.steps.length);
    const targetMissing = Boolean(step.target) && !tour.target;
    if (tourNodes.missing) tourNodes.missing.hidden = !targetMissing;
    tourNodes.back.disabled = tour.index === 0;
    const finalStep = tour.index === tourConfig.steps.length - 1;
    tourNodes.nextLabel.hidden = finalStep;
    tourNodes.doneLabel.hidden = !finalStep;
    const title = localized(step.title);
    announce(
      "ツアー " + String(tour.index + 1) + " / " + String(tourConfig.steps.length) + "。" + title,
      "Tour " + String(tour.index + 1) + " of " + String(tourConfig.steps.length) + ". " + title
    );
  }

  function startTour(launcher) {
    if (!tourNodes.layer || !tourNodes.card || !tourConfig.steps.length) {
      announce("このプレビューにはツアーがありません。", "This preview has no tour.");
      return;
    }
    if (evidence.active) closeEvidence({ returnFocus: false });
    tour.launcher = launcher || document.activeElement || document.querySelector("[data-tour-start]");
    tour.priorDemo = state.demo;
    tour.priorView = state.view;
    tour.active = true;
    tour.index = 0;
    tourNodes.layer.hidden = false;
    document.body.classList.add("tour-open");
    const appShell = document.querySelector(".app-shell");
    if (appShell) appShell.inert = true;
    replaceQuery("tour", "1");
    renderTourStep();
    tourNodes.card.focus({ preventScroll: true });
  }

  function closeTour() {
    if (!tour.active) return;
    tour.active = false;
    clearTourTarget();
    tourNodes.layer.hidden = true;
    document.body.classList.remove("tour-open");
    const appShell = document.querySelector(".app-shell");
    if (appShell) appShell.inert = false;
    replaceQuery("tour", null);
    const returnTarget = tour.launcher;
    const priorDemo = tour.priorDemo;
    const priorView = tour.priorView;
    tour.launcher = null;
    tour.priorDemo = "";
    tour.priorView = "";
    resetDemos({ persist: false, updateUrl: false });
    if (priorDemo) {
      runDemo(priorDemo, {
        persist: false,
        updateUrl: false,
        announce: false,
        delay: false
      });
    }
    if (priorView) {
      selectView(priorView, { persist: false, updateUrl: false, announce: false });
    }
    if (returnTarget && returnTarget.isConnected && typeof returnTarget.focus === "function") {
      returnTarget.focus({ preventScroll: true });
    }
  }

  function moveTour(offset) {
    const next = tour.index + offset;
    if (next < 0) return;
    if (next >= tourConfig.steps.length) {
      closeTour();
      return;
    }
    tour.index = next;
    renderTourStep();
  }

  function tourFocusables() {
    return dialogFocusables(tourNodes.card);
  }

  document.querySelectorAll("[data-tour-start]").forEach(function (button) {
    button.addEventListener("click", function () { startTour(button); });
    if (!tourConfig.steps.length) button.setAttribute("aria-disabled", "true");
  });
  document.querySelectorAll("[data-tour-close], [data-tour-dismiss]").forEach(function (button) {
    button.addEventListener("click", closeTour);
  });
  document.querySelectorAll("[data-tour-restart]").forEach(function (button) {
    button.addEventListener("click", function () {
      tour.index = 0;
      renderTourStep();
      tourNodes.card.focus({ preventScroll: true });
    });
  });
  if (tourNodes.back) tourNodes.back.addEventListener("click", function () { moveTour(-1); });
  if (tourNodes.next) tourNodes.next.addEventListener("click", function () { moveTour(1); });

  document.addEventListener("keydown", function (event) {
    if (!tour.active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeTour();
      return;
    }
    if (event.key === "ArrowLeft" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      moveTour(-1);
      return;
    }
    if (event.key === "ArrowRight" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      moveTour(1);
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = tourFocusables();
    if (!focusables.length) {
      event.preventDefault();
      tourNodes.card.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === tourNodes.card)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  window.addEventListener("scroll", positionTourHighlight, true);
  window.addEventListener("resize", positionTourHighlight);

  /* Initial state: query > localStorage > authored first item. ------------ */
  applyTourControls();
  const queryLocale = validLocale(queryValue("lang") || queryValue("locale"));
  setLocale(queryLocale || validLocale(readStorage(storageKeys.locale)) || "ja", {
    persist: true,
    updateUrl: false,
    announce: false
  });

  const queryView = queryValue("example") || queryValue("view");
  const storedView = readStorage(storageKeys.view);
  selectView(viewExists(queryView) ? queryView : (viewExists(storedView) ? storedView : ""), {
    persist: true,
    updateUrl: false,
    announce: false
  });

  resetDemos({ persist: false, updateUrl: false });
  const queryDemo = queryValue("demo");
  const storedDemo = readStorage(storageKeys.demo);
  const initialDemo = demoResults.some((result) => result.dataset.demoResult === queryDemo) ? queryDemo : storedDemo;
  if (initialDemo) {
    runDemo(initialDemo, { persist: true, updateUrl: false, announce: false, delay: false });
  }

  document.querySelectorAll("[data-tab-target][aria-selected='true']").forEach(function (tab) {
    selectTab(tab, false);
  });

  const queryClaim = queryValue("claim");
  const queryTour = queryValue("tour") === "1";
  const initialClaim = queryClaim && evidenceExists(queryClaim) ? queryClaim : "";

  function initializeOverlays() {
    if (initialClaim) {
      openEvidence(queryClaim, document.querySelector("[data-evidence-launch]"), {
        updateUrl: false,
        announce: false
      });
    }
    if (queryTour) startTour(document.querySelector("[data-tour-start]"));
    window.requestAnimationFrame(function () { root.dataset.previewReady = "true"; });
  }

  if (initialClaim || queryTour) window.requestAnimationFrame(initializeOverlays);
  else root.dataset.previewReady = "true";
})();
