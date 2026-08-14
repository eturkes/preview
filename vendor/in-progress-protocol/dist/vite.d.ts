interface OutputAsset {
    type: "asset";
    source: string | Uint8Array;
}
interface OutputChunk {
    type: "chunk";
    code: string;
}
type OutputBundle = Record<string, OutputAsset | OutputChunk>;
export interface SelfContainedPluginOptions {
    name?: string;
}
export declare function selfContainedPlugin(options?: SelfContainedPluginOptions): {
    name: string;
    apply: "build";
    enforce: "post";
    buildStart(): void;
    transformIndexHtml: {
        order: "post";
        handler(html: string, context: {
            bundle?: OutputBundle;
        }): string;
    };
    generateBundle(_options: unknown, bundle: OutputBundle): void;
    writeBundle(options: {
        dir?: string;
    }): Promise<void>;
};
export {};
