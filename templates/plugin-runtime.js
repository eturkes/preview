/* Preview dashboard selection over the canonical in-progress protocol. */
(function () {
  "use strict";

  const dataNode = document.getElementById("preview-plugin-data");
  const runtimeNode = document.getElementById("preview-plugin-dashboard-runtime");
  const stateNode = document.getElementById("preview-plugin-state");
  const root = document.documentElement;
  const colorTokenProperties = Object.freeze({
    background: ["--page"],
    surface: ["--surface"],
    surfaceRaised: ["--surface-raised"],
    border: ["--line"],
    text: ["--ink"],
    muted: ["--ink-soft", "--ink-muted"],
    accent: ["--accent", "--accent-strong"],
    warning: ["--warning"],
    danger: ["--danger"],
  });
  let dashboards = {};
  let bootError = "";

  try {
    if (!dataNode || !runtimeNode || !stateNode) throw new Error("plugin shell is incomplete");
    dashboards = JSON.parse(dataNode.textContent || "{}");
    if (!dashboards || typeof dashboards !== "object" || Array.isArray(dashboards)) {
      throw new Error("dashboard index is invalid");
    }
  } catch (error) {
    bootError = error instanceof Error ? error.message : "plugin package is invalid";
  }

  function safeColor(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
      ? value
      : null;
  }

  function relativeLuminance(color) {
    const channels = [1, 3, 5].map(function (offset) {
      const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function contrastRatio(first, second) {
    const lighter = Math.max(first, second);
    const darker = Math.min(first, second);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function contrastInk(color) {
    const background = relativeLuminance(color);
    const candidates = ["#101820", "#ffffff"].map(function (ink) {
      return { ink, ratio: contrastRatio(background, relativeLuminance(ink)) };
    }).sort(function (left, right) { return right.ratio - left.ratio; });
    return candidates[0].ratio >= 4.5 ? candidates[0].ink : "#000000";
  }

  function safeFont(value, fallback) {
    return typeof value === "string" && /^[A-Za-z0-9 ._-]{1,80}$/.test(value)
      ? `"${value}", ${fallback}`
      : null;
  }

  function applyHostTheme(theme) {
    if (!theme || (theme.mode !== "dark" && theme.mode !== "light")) return;
    root.dataset.previewThemeMode = theme.mode;
    const tokens = theme.tokens;
    if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return;
    Object.entries(colorTokenProperties).forEach(function ([name, properties]) {
      const value = safeColor(tokens[name]);
      if (!value) return;
      properties.forEach(function (property) { root.style.setProperty(property, value); });
    });
    const uiFont = safeFont(
      tokens.uiFont,
      '"Segoe UI Variable", "Yu Gothic UI", sans-serif'
    );
    const monoFont = safeFont(tokens.monoFont, 'Consolas, "Yu Gothic UI", monospace');
    if (uiFont) root.style.setProperty("--font-ui", uiFont);
    if (monoFont) root.style.setProperty("--font-mono", monoFont);
    const accent = safeColor(tokens.accent);
    if (accent) root.style.setProperty("--accent-ink", contrastInk(accent));
  }

  function state(kind, heading, detail, projectId, theme) {
    root.lang = "ja";
    root.dataset.locale = "ja";
    root.className = "theme-graphite font-humanist";
    applyHostTheme(theme);
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

  function mount(dashboard, theme) {
    if (
      !dashboard ||
      typeof dashboard.body !== "string" ||
      typeof dashboard.className !== "string" ||
      typeof dashboard.title !== "string"
    ) {
      throw new Error("packaged dashboard is invalid");
    }
    const source = runtimeNode.textContent || "";
    root.lang = "ja";
    root.dataset.locale = "ja";
    root.className = dashboard.className;
    applyHostTheme(theme);
    document.title = dashboard.title;
    document.body.innerHTML = dashboard.body;
    const runtime = document.createElement("script");
    runtime.textContent = source;
    document.head.append(runtime);
  }

  async function connect() {
    let client;
    try {
      const protocol = globalThis.InProgressProtocol;
      if (!protocol || typeof protocol.connectInProgress !== "function") {
        throw new Error("canonical in-progress protocol is unavailable");
      }
      client = await protocol.connectInProgress({
        applyTheme: false,
        requiredCapabilities: [],
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "host connection failed";
      state(
        "Preview error",
        "ホストに接続できません / Could not connect to host",
        detail,
        "",
        null,
      );
      return;
    }
    const project = client.context.project;
    const theme = client.context.theme;
    const projectId = project && typeof project.id === "string" ? project.id : "";
    const dashboard = Object.prototype.hasOwnProperty.call(dashboards, projectId)
      ? dashboards[projectId]
      : null;
    let status;
    try {
      if (bootError) throw new Error(bootError);
      if (dashboard) {
        mount(dashboard, theme);
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
          theme,
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
        theme,
      );
      status = { state: "error", badge: null, title: "Preview package error" };
    }

    client.setStatus(status);
  }

  void connect();
})();
