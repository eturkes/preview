import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import vm from "node:vm"

const source = await readFile(new URL("../templates/plugin-runtime.js", import.meta.url), "utf8")

type Element = {
  append(...children: Element[]): void
  children: Element[]
  className: string
  tagName: string
  textContent: string
  replaceChildren(...children: Element[]): void
}

function element(tagName: string): Element {
  return {
    append(...children) {
      this.children.push(...children)
    },
    children: [],
    className: "",
    replaceChildren(...children) {
      this.children = children
    },
    tagName,
    textContent: "",
  }
}

function styleDeclaration() {
  const values = new Map<string, string>()
  return {
    getPropertyValue(name: string) {
      return values.get(name) ?? ""
    },
    setProperty(name: string, value: string) {
      values.set(name, value)
    },
  }
}

const hostTheme = {
  mode: "dark",
  tokens: {
    accent: "#67d5b5",
    background: "#0b0e14",
    border: "#283142",
    danger: "#ff6b78",
    monoFont: "Iosevka",
    muted: "#909cb0",
    surface: "#121722",
    surfaceRaised: "#18202c",
    text: "#e7ecf4",
    uiFont: "Atkinson Hyperlegible Next",
    warning: "#f2b84b",
  },
}

async function harness(
  dashboards: Record<string, { body: string; className: string; title: string }>,
  selected: string,
  theme: { mode: string; tokens: Record<string, string> } = hostTheme,
) {
  const stateNode = element("main")
  const dataNode = { textContent: JSON.stringify(dashboards) }
  const runtimeNode = { textContent: "dashboardRuntime();" }
  const appended: Element[] = []
  const status: unknown[] = []
  const style = styleDeclaration()
  const documentElement = { className: "", dataset: {} as Record<string, string>, lang: "", style }
  const body = { innerHTML: "" }
  const document = {
    body,
    createElement: element,
    documentElement,
    getElementById(id: string) {
      return (
        (
          {
            "preview-plugin-dashboard-runtime": runtimeNode,
            "preview-plugin-data": dataNode,
            "preview-plugin-state": stateNode,
          } as Record<string, unknown>
        )[id] ?? null
      )
    },
    head: {
      append(node: Element) {
        appended.push(node)
      },
    },
    title: "",
  }
  const client = {
    context: { project: { id: selected, name: selected }, theme },
    setStatus(value: unknown) {
      status.push(value)
    },
  }
  const context = vm.createContext({
    document,
    InProgressProtocol: {
      async connectInProgress() {
        return client
      },
    },
    window: {},
  })
  vm.runInContext(source, context)
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { appended, body, document, stateNode, status }
}

const matched = await harness(
  {
    "in-progress": {
      body: '<main id="in-progress">in-progress</main>',
      className: "theme-graphite font-technical",
      title: "in-progress",
    },
  },
  "in-progress",
)
assert.equal(matched.body.innerHTML, '<main id="in-progress">in-progress</main>')
assert.equal(matched.document.documentElement.className, "theme-graphite font-technical")
assert.equal(matched.document.documentElement.dataset.previewThemeMode, "dark")
assert.equal(matched.document.documentElement.style.getPropertyValue("--page"), "#0b0e14")
assert.equal(matched.document.documentElement.style.getPropertyValue("--accent"), "#67d5b5")
assert.equal(matched.document.documentElement.style.getPropertyValue("--accent-ink"), "#101820")
assert.match(
  matched.document.documentElement.style.getPropertyValue("--font-ui"),
  /^"Atkinson Hyperlegible Next"/,
)
assert.equal(matched.document.title, "in-progress")
assert.equal(matched.appended[0]!.textContent, "dashboardRuntime();")
assert.equal((matched.status[0] as { state: string }).state, "idle")

const unavailable = await harness({}, "missing")
assert.equal((unavailable.status[0] as { state: string }).state, "attention")
assert.match(unavailable.stateNode.children[0]!.children[1]!.textContent, /No preview available/)
assert.equal(unavailable.stateNode.children[0]!.children[3]!.textContent, "missing")

const unsafe = await harness({}, "missing", {
  mode: "light",
  tokens: {
    accent: "#101010",
    background: "url(https://example.invalid/pixel)",
    uiFont: 'bad"; color: red',
  },
})
assert.equal(unsafe.document.documentElement.dataset.previewThemeMode, "light")
assert.equal(unsafe.document.documentElement.style.getPropertyValue("--page"), "")
assert.equal(unsafe.document.documentElement.style.getPropertyValue("--font-ui"), "")
assert.equal(unsafe.document.documentElement.style.getPropertyValue("--accent"), "#101010")
assert.equal(unsafe.document.documentElement.style.getPropertyValue("--accent-ink"), "#ffffff")
