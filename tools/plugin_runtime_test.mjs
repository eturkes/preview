import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../templates/plugin-runtime.js", import.meta.url), "utf8");

function element(tagName) {
  return {
    tagName,
    children: [],
    className: "",
    textContent: "",
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  };
}

function styleDeclaration() {
  const values = new Map();
  return {
    getPropertyValue(name) { return values.get(name) ?? ""; },
    setProperty(name, value) { values.set(name, value); },
  };
}

function harness(dashboards) {
  const parent = {};
  const listeners = new Map();
  const stateNode = element("main");
  const dataNode = { textContent: JSON.stringify(dashboards) };
  const runtimeNode = { textContent: "dashboardRuntime();" };
  const appended = [];
  const documentElement = { lang: "", dataset: {}, className: "", style: styleDeclaration() };
  const body = { value: "" };
  Object.defineProperty(body, "innerHTML", {
    get() { return this.value; },
    set(value) { this.value = value; },
  });
  const document = {
    body,
    documentElement,
    title: "",
    head: { append(node) { appended.push(node); } },
    createElement: element,
    getElementById(id) {
      return {
        "preview-plugin-data": dataNode,
        "preview-plugin-dashboard-runtime": runtimeNode,
        "preview-plugin-state": stateNode,
      }[id] ?? null;
    },
  };
  const window = {
    parent,
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
  };
  vm.runInNewContext(source, { document, window });
  return { appended, body, document, listeners, parent, stateNode };
}

function port() {
  return {
    closed: false,
    messages: [],
    close() { this.closed = true; },
    postMessage(message) { this.messages.push(message); },
  };
}

const hostTheme = {
  mode: "dark",
  tokens: {
    background: "#0b0e14",
    surface: "#121722",
    surfaceRaised: "#18202c",
    border: "#283142",
    text: "#e7ecf4",
    muted: "#909cb0",
    accent: "#67d5b5",
    warning: "#f2b84b",
    danger: "#ff6b78",
    uiFont: "Atkinson Hyperlegible Next",
    monoFont: "Iosevka",
  },
};

function initialize(runtime, selected, apiVersion = "1.0", theme = hostTheme) {
  const channel = port();
  runtime.listeners.get("message")({
    source: runtime.parent,
    data: {
      type: "in-progress:init",
      nonce: "nonce-1",
      context: { apiVersion, project: { id: selected, name: selected }, theme },
    },
    ports: [channel],
  });
  return channel;
}

const matched = harness({
  "in-progress": {
    body: '<main id="in-progress">in-progress</main>',
    className: "theme-graphite font-technical",
    title: "in-progress",
  },
});
const ignored = port();
matched.listeners.get("message")({
  source: {},
  data: { type: "in-progress:init", nonce: "hostile", context: { apiVersion: "1.0" } },
  ports: [ignored],
});
assert.equal(ignored.messages.length, 0);
const matchedPort = initialize(matched, "in-progress");
assert.equal(matched.body.innerHTML, '<main id="in-progress">in-progress</main>');
assert.equal(matched.document.documentElement.className, "theme-graphite font-technical");
assert.equal(matched.document.documentElement.dataset.previewThemeMode, "dark");
assert.equal(matched.document.documentElement.style.getPropertyValue("--page"), "#0b0e14");
assert.equal(matched.document.documentElement.style.getPropertyValue("--surface"), "#121722");
assert.equal(matched.document.documentElement.style.getPropertyValue("--accent"), "#67d5b5");
assert.equal(matched.document.documentElement.style.getPropertyValue("--accent-ink"), "#101820");
assert.match(
  matched.document.documentElement.style.getPropertyValue("--font-ui"),
  /^"Atkinson Hyperlegible Next"/,
);
assert.equal(matched.document.title, "in-progress");
assert.equal(matched.appended[0].textContent, "dashboardRuntime();");
assert.deepEqual(JSON.parse(JSON.stringify(matchedPort.messages[0])), {
  kind: "ready",
  nonce: "nonce-1",
});
assert.equal(matchedPort.messages[1].payload.state, "idle");

const unavailable = harness({});
const unavailablePort = initialize(unavailable, "missing");
assert.equal(unavailablePort.messages[0].kind, "ready");
assert.equal(unavailablePort.messages[1].payload.state, "attention");
assert.match(unavailable.stateNode.children[0].children[1].textContent, /No preview available/);
assert.equal(unavailable.stateNode.children[0].children[3].textContent, "missing");

const unsafeTheme = harness({});
initialize(unsafeTheme, "missing", "1.0", {
  mode: "light",
  tokens: {
    background: "url(https://example.invalid/pixel)",
    accent: "#101010",
    uiFont: 'bad"; color: red',
  },
});
assert.equal(unsafeTheme.document.documentElement.dataset.previewThemeMode, "light");
assert.equal(unsafeTheme.document.documentElement.style.getPropertyValue("--page"), "");
assert.equal(unsafeTheme.document.documentElement.style.getPropertyValue("--font-ui"), "");
assert.equal(unsafeTheme.document.documentElement.style.getPropertyValue("--accent"), "#101010");
assert.equal(
  unsafeTheme.document.documentElement.style.getPropertyValue("--accent-ink"),
  "#ffffff",
);

const boundaryTheme = harness({});
initialize(boundaryTheme, "missing", "1.0", {
  mode: "light",
  tokens: { accent: "#777777" },
});
assert.equal(
  boundaryTheme.document.documentElement.style.getPropertyValue("--accent-ink"),
  "#000000",
);

const invalidTheme = harness({});
initialize(invalidTheme, "missing", "1.0", {
  mode: "auto",
  tokens: { background: "#ffffff" },
});
assert.equal(invalidTheme.document.documentElement.dataset.previewThemeMode, undefined);
assert.equal(invalidTheme.document.documentElement.style.getPropertyValue("--page"), "");

const incompatible = harness({});
const incompatiblePort = initialize(incompatible, "alpha", "2.0");
assert.equal(incompatiblePort.closed, true);
assert.equal(incompatiblePort.messages.length, 0);
