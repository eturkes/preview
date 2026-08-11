/* in-progress plugin API 1.0 handshake + dashboard selection. */
(function () {
  "use strict";

  const apiVersion = "1.0";
  const dataNode = document.getElementById("preview-plugin-data");
  const runtimeNode = document.getElementById("preview-plugin-dashboard-runtime");
  const stateNode = document.getElementById("preview-plugin-state");
  let dashboards = {};
  let bootError = "";
  let connected = false;

  try {
    if (!dataNode || !runtimeNode || !stateNode) throw new Error("plugin shell is incomplete");
    dashboards = JSON.parse(dataNode.textContent || "{}");
    if (!dashboards || typeof dashboards !== "object" || Array.isArray(dashboards)) {
      throw new Error("dashboard index is invalid");
    }
  } catch (error) {
    bootError = error instanceof Error ? error.message : "plugin package is invalid";
  }

  function state(kind, heading, detail, projectId) {
    document.documentElement.lang = "ja";
    document.documentElement.dataset.locale = "ja";
    document.documentElement.className = "theme-graphite font-humanist";
    document.title = heading;
    const card = document.createElement("section");
    card.className = "preview-plugin-state__card";
    const eyebrow = document.createElement("p");
    eyebrow.className = "preview-plugin-state__eyebrow";
    eyebrow.textContent = kind;
    const title = document.createElement("h1");
    title.textContent = heading;
    const body = document.createElement("p");
    body.textContent = detail;
    card.append(eyebrow, title, body);
    if (projectId) {
      const identity = document.createElement("code");
      identity.textContent = projectId;
      card.append(identity);
    }
    stateNode.replaceChildren(card);
  }

  function mount(dashboard) {
    if (
      !dashboard ||
      typeof dashboard.body !== "string" ||
      typeof dashboard.className !== "string" ||
      typeof dashboard.title !== "string"
    ) {
      throw new Error("packaged dashboard is invalid");
    }
    const source = runtimeNode.textContent || "";
    document.documentElement.lang = "ja";
    document.documentElement.dataset.locale = "ja";
    document.documentElement.className = dashboard.className;
    document.title = dashboard.title;
    document.body.innerHTML = dashboard.body;
    const runtime = document.createElement("script");
    runtime.textContent = source;
    document.head.append(runtime);
  }

  function sendStatus(port, value) {
    port.postMessage({ kind: "event", name: "status", payload: value });
  }

  function receive(event) {
    const message = event.data;
    if (
      connected ||
      event.source !== window.parent ||
      !message ||
      message.type !== "in-progress:init"
    ) {
      return;
    }
    const port = event.ports && event.ports[0];
    if (!port) return;
    if (
      !message.context ||
      message.context.apiVersion !== apiVersion ||
      typeof message.nonce !== "string"
    ) {
      port.close();
      return;
    }

    connected = true;
    window.removeEventListener("message", receive);
    const project = message.context.project;
    const projectId = project && typeof project.id === "string" ? project.id : "";
    const dashboard = Object.prototype.hasOwnProperty.call(dashboards, projectId)
      ? dashboards[projectId]
      : null;
    let status;
    try {
      if (bootError) throw new Error(bootError);
      if (dashboard) {
        mount(dashboard);
        status = {
          state: "idle",
          badge: null,
          title: `Preview: ${dashboard.title}`.slice(0, 80),
        };
      } else {
        state(
          "Preview unavailable",
          "プレビューがありません / No preview available",
          "選択中のプロジェクトに一致する公開済みダッシュボードがありません。 / No published dashboard matches the selected project.",
          projectId,
        );
        status = { state: "attention", badge: null, title: "No matching Preview dashboard" };
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "plugin package could not be loaded";
      state(
        "Preview error",
        "プレビューを読み込めません / Preview could not load",
        detail,
        projectId,
      );
      status = { state: "error", badge: null, title: "Preview package error" };
    }

    port.postMessage({ kind: "ready", nonce: message.nonce });
    sendStatus(port, status);
    window.addEventListener("pagehide", function () { port.close(); }, { once: true });
  }

  window.addEventListener("message", receive);
})();
