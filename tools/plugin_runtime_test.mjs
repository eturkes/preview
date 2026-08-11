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

function harness(dashboards) {
  const parent = {};
  const listeners = new Map();
  const stateNode = element("main");
  const dataNode = { textContent: JSON.stringify(dashboards) };
  const runtimeNode = { textContent: "dashboardRuntime();" };
  const appended = [];
  const documentElement = { lang: "", dataset: {}, className: "" };
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

function initialize(runtime, selected, apiVersion = "1.0") {
  const channel = port();
  runtime.listeners.get("message")({
    source: runtime.parent,
    data: {
      type: "in-progress:init",
      nonce: "nonce-1",
      context: { apiVersion, project: { id: selected, name: selected } },
    },
    ports: [channel],
  });
  return channel;
}

const matched = harness({
  alpha: { body: '<main id="alpha">Alpha</main>', className: "theme-forest font-humanist", title: "Alpha" },
});
const ignored = port();
matched.listeners.get("message")({
  source: {},
  data: { type: "in-progress:init", nonce: "hostile", context: { apiVersion: "1.0" } },
  ports: [ignored],
});
assert.equal(ignored.messages.length, 0);
const matchedPort = initialize(matched, "alpha");
assert.equal(matched.body.innerHTML, '<main id="alpha">Alpha</main>');
assert.equal(matched.document.documentElement.className, "theme-forest font-humanist");
assert.equal(matched.document.title, "Alpha");
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

const incompatible = harness({});
const incompatiblePort = initialize(incompatible, "alpha", "2.0");
assert.equal(incompatiblePort.closed, true);
assert.equal(incompatiblePort.messages.length, 0);
