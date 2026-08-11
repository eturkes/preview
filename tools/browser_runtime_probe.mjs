#!/usr/bin/env node
/* No-dependency Chromium DevTools probe for the trusted dashboard runtime. */

"use strict";

import { writeFile } from "node:fs/promises";

const [baseUrl, debugPortText, pluginProject, screenshotPrefix] = process.argv.slice(2);
if (!baseUrl || !/^\d+$/.test(debugPortText || "")) {
  throw new Error(
    "usage: browser_runtime_probe.mjs BASE_URL DEBUG_PORT [PLUGIN_PROJECT] [SCREENSHOT_PREFIX]"
  );
}
if (typeof WebSocket !== "function") {
  throw new Error("browser runtime probe requires a Node.js release with global WebSocket");
}

const debugOrigin = "http://127.0.0.1:" + debugPortText;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function pageSocketUrl() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(debugOrigin + "/json/list");
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (_error) {
      /* Chromium may expose its port before the target list is ready. */
    }
    await delay(50);
  }
  throw new Error("Chromium page target did not become ready");
}

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.runtimeExceptions = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method === "Runtime.exceptionThrown") {
        const detail = message.params?.exceptionDetails;
        this.runtimeExceptions.push(
          detail?.exception?.description || detail?.text || "unknown uncaught browser exception"
        );
        return;
      }
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP WebSocket connection timed out")), 5000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("CDP WebSocket connection failed"));
      }, { once: true });
    });
    return new CdpSession(socket);
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CDP command timed out: " + method));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }

  assertNoRuntimeExceptions() {
    if (this.runtimeExceptions.length) {
      throw new Error("uncaught browser exception:\n" + this.runtimeExceptions.join("\n"));
    }
  }
}

const session = await CdpSession.connect(await pageSocketUrl());

async function evaluate(expression) {
  const response = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description ||
      response.exceptionDetails.text || "browser evaluation failed";
    throw new Error(detail);
  }
  return response.result ? response.result.value : undefined;
}

async function waitFor(expression, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      if (await evaluate(expression)) return;
    } catch (_error) {
      /* Navigation destroys the old execution context before creating the next. */
    }
    await delay(25);
  }
  throw new Error("browser state timed out: " + label);
}

async function captureViewport(width, height, suffix, mobile) {
  await session.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
  await delay(50);
  const shot = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  assert(typeof shot.data === "string" && shot.data.length > 0, "empty browser screenshot");
  await writeFile(screenshotPrefix + "-" + suffix + ".png", Buffer.from(shot.data, "base64"));
}

async function navigate(url, readyUrl = url) {
  await session.send("Page.navigate", { url });
  if (pluginProject) {
    const initial = JSON.stringify(new URL(url).href);
    await waitFor(
      "location.href === " + initial +
        " && document.readyState === 'complete'" +
        " && document.getElementById('preview-plugin-data') !== null",
      "plugin shell " + url
    );
    const project = JSON.stringify(pluginProject);
    await evaluate(`(() => {
      const channel = new MessageChannel();
      window.__previewProbePort = channel.port1;
      window.postMessage({
        type: 'in-progress:init',
        nonce: 'preview-browser-probe',
        context: {
          apiVersion: '1.0',
          capabilities: [],
          project: { id: ${project}, name: ${project}, color: '#67d5b5', available: true },
          theme: {
            mode: 'dark',
            tokens: {
              background: '#0b0e14', surface: '#121722', surfaceRaised: '#18202c',
              border: '#283142', text: '#e7ecf4', muted: '#909cb0', accent: '#67d5b5',
              warning: '#f2b84b', danger: '#ff6b78',
              uiFont: 'Atkinson Hyperlegible Next', monoFont: 'Iosevka'
            }
          }
        }
      }, '*', [channel.port2]);
    })()`);
  }
  const expected = JSON.stringify(new URL(readyUrl).href);
  await waitFor(
    "location.href === " + expected +
      " && document.documentElement.dataset.previewReady === 'true'",
    url
  );
}

async function press(key, { shift = false } = {}) {
  const modifiers = shift ? 8 : 0;
  const code = key === "Escape" ? "Escape" : "Tab";
  const virtualKey = key === "Escape" ? 27 : 9;
  await session.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key,
    code,
    modifiers,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey
  });
  await session.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    modifiers,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey
  });
  await delay(25);
}

try {
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await navigate(baseUrl);

  const shell = await evaluate(`(() => {
    const tour = document.getElementById('preview-tour');
    let steps = 0;
    try { steps = JSON.parse(tour?.textContent || '{}').steps?.length || 0; } catch (_error) {}
    return {
      announcer: document.querySelectorAll('[data-preview-announcer]').length,
      skipLink: document.querySelectorAll('a.skip-link[href="#preview-main"]').length,
      tourLayer: document.querySelectorAll('[data-tour-layer]').length,
      steps,
      themeMode: document.documentElement.dataset.previewThemeMode || '',
      page: getComputedStyle(document.documentElement).getPropertyValue('--page').trim()
    };
  })()`);
  assert(shell.announcer === 1 && shell.skipLink === 1, "dashboard shell lacks a11y nodes");
  assert(shell.tourLayer === 1 && shell.steps > 0, "dashboard shell lacks guided-tour state");
  if (pluginProject) {
    assert(shell.themeMode === "dark" && shell.page === "#0b0e14", "plugin ignored host theme");
  }
  if (screenshotPrefix) {
    await captureViewport(1440, 1000, "desktop", false);
    await captureViewport(390, 844, "mobile", true);
    await session.send("Emulation.clearDeviceMetricsOverride");
  }

  const claimKeys = await evaluate(
    "Array.from(document.querySelectorAll('[data-evidence-select]'), " +
      "(row) => row.dataset.evidenceSelect)"
  );
  assert(Array.isArray(claimKeys) && claimKeys.length > 1, "fixture needs at least two claims");
  const claim = claimKeys[1];
  const claimLiteral = JSON.stringify(claim);

  await navigate(new URL("?claim=" + encodeURIComponent(claim), baseUrl).href);
  const deepLink = await evaluate(`(() => {
    const key = ${claimLiteral};
    const row = Array.from(document.querySelectorAll('[data-evidence-select]'))
      .find((candidate) => candidate.dataset.evidenceSelect === key);
    const detail = Array.from(document.querySelectorAll('[data-evidence-detail]'))
      .find((candidate) => candidate.dataset.evidenceDetail === key);
    const drawer = document.querySelector('[data-evidence-drawer]');
    return {
      search: location.search,
      rowSelected: row?.getAttribute('aria-pressed'),
      detailVisible: detail ? !detail.hidden : false,
      layerVisible: !document.querySelector('[data-evidence-layer]')?.hidden,
      activeClaim: document.activeElement?.dataset.evidenceDetail || '',
      activeInside: drawer?.contains(document.activeElement) || false
    };
  })()`);
  assert(new URLSearchParams(deepLink.search).get("claim") === claim, "deep link rewrote claim");
  assert(deepLink.rowSelected === "true" && deepLink.detailVisible, "deep link selected wrong claim");
  assert(deepLink.layerVisible && deepLink.activeInside, "deep link did not open/focus dialog");
  assert(deepLink.activeClaim === claim, "deep link did not focus selected detail");

  await press("Tab", { shift: true });
  assert(
    await evaluate("document.activeElement?.dataset.evidenceSelect === " + claimLiteral),
    "Shift+Tab from detail did not return to selected row"
  );
  await evaluate(
    "Array.from(document.querySelectorAll('[data-evidence-detail]'))" +
      ".find((detail) => detail.dataset.evidenceDetail === " + claimLiteral + ").focus()"
  );
  await press("Tab");
  assert(
    await evaluate("document.activeElement?.hasAttribute('data-evidence-close') === true"),
    "Tab from final detail escaped the dialog"
  );
  await press("Escape");
  const escaped = await evaluate(`({
    closed: document.querySelector('[data-evidence-layer]')?.hidden === true,
    inert: document.querySelector('.app-shell')?.inert === true,
    claim: new URL(location.href).searchParams.get('claim'),
    focusReturned: document.activeElement?.hasAttribute('data-evidence-launch') === true
  })`);
  assert(escaped.closed && !escaped.inert && escaped.claim === null, "Escape did not close cleanly");
  assert(escaped.focusReturned, "Escape did not restore launcher focus");

  await navigate(baseUrl);
  await evaluate(
    "Array.from(document.querySelectorAll('[data-evidence-open]'))" +
      ".find((button) => button.dataset.evidenceOpen === " + claimLiteral + ").click()"
  );
  await waitFor(
    "document.activeElement?.dataset.evidenceDetail === " + claimLiteral,
    "claim badge open"
  );
  assert(
    await evaluate("new URL(location.href).searchParams.get('claim') === " + claimLiteral),
    "claim badge did not create its URL state"
  );
  await evaluate("document.querySelector('[data-evidence-dismiss]').click()");
  assert(
    await evaluate("document.activeElement?.dataset.evidenceOpen === " + claimLiteral),
    "backdrop close did not restore claim-button focus"
  );

  await navigate(baseUrl);
  await evaluate(`(() => {
    document.querySelector('[data-evidence-launch]').click();
    Array.from(document.querySelectorAll('[data-evidence-select]'))
      .find((row) => row.dataset.evidenceSelect === ${claimLiteral}).click();
  })()`);
  await waitFor(
    "document.activeElement?.dataset.evidenceDetail === " + claimLiteral,
    "ledger row selection"
  );
  assert(
    await evaluate("new URL(location.href).searchParams.get('claim') === " + claimLiteral),
    "ledger row did not update its URL state"
  );

  await navigate(baseUrl);
  await evaluate("document.querySelector('[data-evidence-launch]').click()");
  const populatedFilters = await evaluate(`(() => {
    const statuses = ['verified', 'inferred', 'gap'];
    const allRows = Array.from(document.querySelectorAll('[data-evidence-select]'));
    const expected = Object.fromEntries(statuses.map((status) => [
      status,
      allRows.filter((row) => row.dataset.provenanceStatus === status)
        .map((row) => row.dataset.evidenceSelect)
    ]));
    return statuses.map((status) => {
      document.querySelector('[data-evidence-filter="' + status + '"]').click();
      const rows = Array.from(document.querySelectorAll('[data-evidence-select]'))
        .filter((row) => !row.hidden);
      const details = Array.from(document.querySelectorAll('[data-evidence-detail]'))
        .filter((detail) => !detail.hidden);
      return {
        status,
        rows: rows.length,
        exactRows: JSON.stringify(rows.map((row) => row.dataset.evidenceSelect)) ===
          JSON.stringify(expected[status]),
        rowsMatch: rows.every((row) => row.dataset.provenanceStatus === status),
        selected: rows.filter((row) => row.getAttribute('aria-pressed') === 'true').length,
        details: details.length,
        detailMatches: details.every((detail) => detail.dataset.provenanceStatus === status),
        urlMatches: new URL(location.href).searchParams.get('claim') ===
          rows.find((row) => row.getAttribute('aria-pressed') === 'true')?.dataset.evidenceSelect
      };
    });
  })()`);
  assert(
    populatedFilters.every((result) =>
      result.rows > 0 && result.exactRows && result.rowsMatch && result.selected === 1 &&
      result.details === 1 && result.detailMatches && result.urlMatches
    ),
    "populated evidence filter selected the wrong rows or detail"
  );
  await evaluate(`(() => {
    document.querySelectorAll('[data-evidence-select]').forEach((row) => {
      row.dataset.provenanceStatus = 'verified';
    });
    document.querySelector('[data-evidence-filter="gap"]').click();
  })()`);
  const emptyFilter = await evaluate(`({
    emptyVisible: !document.querySelector('[data-evidence-filter-empty]')?.hidden,
    visibleRows: Array.from(document.querySelectorAll('[data-evidence-select]'))
      .filter((row) => !row.hidden).length,
    visibleDetails: Array.from(document.querySelectorAll('[data-evidence-detail]'))
      .filter((detail) => !detail.hidden).length,
    claim: new URL(location.href).searchParams.get('claim')
  })`);
  assert(
    emptyFilter.emptyVisible && emptyFilter.visibleRows === 0 &&
      emptyFilter.visibleDetails === 0 && emptyFilter.claim === null,
    "zero-result filter retained stale selection"
  );

  await navigate(
    new URL("?claim=" + encodeURIComponent(claim) + "&tour=1", baseUrl).href,
    new URL("?tour=1", baseUrl).href
  );
  const exclusive = await evaluate(`({
    evidenceHidden: document.querySelector('[data-evidence-layer]')?.hidden === true,
    tourVisible: document.querySelector('[data-tour-layer]')?.hidden === false,
    claim: new URL(location.href).searchParams.get('claim'),
    tour: new URL(location.href).searchParams.get('tour'),
    focusInTour: document.querySelector('[data-tour-card]')?.contains(document.activeElement) ||
      document.activeElement?.hasAttribute('data-tour-card') || false
  })`);
  assert(exclusive.evidenceHidden && exclusive.tourVisible, "claim and tour overlays overlapped");
  assert(exclusive.claim === null && exclusive.tour === "1", "overlay URL state is inconsistent");
  assert(exclusive.focusInTour, "tour did not own focus");

  await delay(25);
  session.assertNoRuntimeExceptions();
  process.stdout.write("browser runtime probe: evidence URL, filters, focus, close, and tour states OK\n");
} finally {
  session.close();
}
