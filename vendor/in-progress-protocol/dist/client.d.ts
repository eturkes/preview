import { type PluginCapability, type PluginContext, type PluginMethodMap, type PluginStatus } from "./schemas.js";
export interface PluginCallOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
}
export interface ConnectInProgressOptions {
    target?: Window;
    timeoutMs?: number;
    requiredCapabilities?: readonly PluginCapability[];
    applyTheme?: boolean;
}
export declare class InProgressClient {
    #private;
    readonly context: PluginContext;
    constructor(port: MessagePort, context: PluginContext, target?: Window);
    call<Method extends PluginCapability>(method: Method, ...args: undefined extends PluginMethodMap[Method]["params"] ? [params?: PluginMethodMap[Method]["params"], options?: PluginCallOptions] : [params: PluginMethodMap[Method]["params"], options?: PluginCallOptions]): Promise<PluginMethodMap[Method]["result"]>;
    setStatus(status: PluginStatus): void;
    dispose(): void;
}
export declare function applyPluginTheme(theme: PluginContext["theme"], root?: HTMLElement): void;
export declare function connectInProgress(options?: ConnectInProgressOptions): Promise<InProgressClient>;
