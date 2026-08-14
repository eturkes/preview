import { rm, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
function attribute(tag, name) {
    const match = new RegExp(`\\b${name}\\s*=\\s*(["'])([^"']+)\\1`, "i").exec(tag);
    return match?.[2] ?? null;
}
function bundlePath(reference) {
    if (!reference || /^[a-z][a-z\d+.-]*:/i.test(reference))
        return null;
    return reference.replace(/^\.?\//, "").split(/[?#]/, 1)[0] ?? null;
}
function text(source) {
    return typeof source === "string" ? source : new TextDecoder().decode(source);
}
function within(root, candidate) {
    const path = relative(root, candidate);
    return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
export function selfContainedPlugin(options = {}) {
    const consumed = new Set();
    let entryTags = [];
    return {
        name: options.name ?? "in-progress-self-contained-plugin",
        apply: "build",
        enforce: "post",
        buildStart() {
            consumed.clear();
            entryTags = [];
        },
        transformIndexHtml: {
            order: "post",
            handler(html, context) {
                const bundle = context.bundle;
                if (!bundle)
                    throw new Error("Plugin build output is unavailable");
                html = html.replace(/<link\b[^>]*>/gi, (tag) => {
                    if (attribute(tag, "rel")?.toLowerCase() !== "stylesheet")
                        return tag;
                    const fileName = bundlePath(attribute(tag, "href"));
                    const output = fileName ? bundle[fileName] : undefined;
                    if (!fileName || output?.type !== "asset" || !fileName.endsWith(".css"))
                        return tag;
                    consumed.add(fileName);
                    return `<style>${text(output.source).replace(/<\/style/gi, "<\\/style")}</style>`;
                });
                html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => {
                    const fileName = bundlePath(attribute(tag, "src"));
                    const output = fileName ? bundle[fileName] : undefined;
                    if (!fileName || output?.type !== "chunk")
                        return tag;
                    consumed.add(fileName);
                    return `<script type="module">${output.code.replace(/<\/script/gi, "<\\/script")}</script>`;
                });
                entryTags = [...html.matchAll(/<(?:script|link)\b[^>]*>/gi)].map(([tag]) => tag);
                return html;
            },
        },
        generateBundle(_options, bundle) {
            const external = Object.keys(bundle).filter((fileName) => !fileName.endsWith(".html") && !consumed.has(fileName));
            if (external.length > 0) {
                throw new Error(`Plugin build emitted uninlined assets: ${external.join(", ")}; entry tags: ${entryTags.join(" ")}`);
            }
        },
        async writeBundle(options) {
            if (!options.dir)
                throw new Error("Plugin output directory is unavailable");
            const output = resolve(options.dir);
            const directories = new Set();
            for (const fileName of consumed) {
                const file = resolve(output, fileName);
                if (!within(output, file))
                    throw new Error(`Plugin output escaped build root: ${fileName}`);
                await rm(file);
                for (let directory = dirname(file); directory !== output; directory = dirname(directory)) {
                    if (!within(output, directory))
                        break;
                    directories.add(directory);
                }
            }
            for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
                if (directory !== output)
                    await rmdir(directory);
            }
        },
    };
}
