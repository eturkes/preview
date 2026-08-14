import { z } from "zod";
export declare const PLUGIN_API_VERSION: "1.0";
export declare const PLUGIN_CAPABILITIES: readonly ["project.metadata", "project.tree", "project.readText", "project.git", "host.notify", "align.status", "drift.render", "drift.validateTraces", "drift.recentSessions", "drift.importSession", "drift.analyze", "tree-complete.workspace", "tree-complete.createFork", "slide-gen.status", "slide-gen.generate", "slide-gen.render"];
export declare const PluginCapabilitySchema: z.ZodEnum<{
    "align.status": "align.status";
    "drift.analyze": "drift.analyze";
    "drift.importSession": "drift.importSession";
    "drift.recentSessions": "drift.recentSessions";
    "drift.render": "drift.render";
    "drift.validateTraces": "drift.validateTraces";
    "host.notify": "host.notify";
    "project.git": "project.git";
    "project.metadata": "project.metadata";
    "project.readText": "project.readText";
    "project.tree": "project.tree";
    "slide-gen.generate": "slide-gen.generate";
    "slide-gen.render": "slide-gen.render";
    "slide-gen.status": "slide-gen.status";
    "tree-complete.createFork": "tree-complete.createFork";
    "tree-complete.workspace": "tree-complete.workspace";
}>;
export type PluginCapability = z.infer<typeof PluginCapabilitySchema>;
export declare const PluginManifestSchema: z.ZodObject<{
    apiVersion: z.ZodLiteral<"1.0">;
    id: z.ZodString;
    name: z.ZodString;
    version: z.ZodString;
    description: z.ZodString;
    entry: z.ZodString;
    assets: z.ZodDefault<z.ZodArray<z.ZodString>>;
    icon: z.ZodDefault<z.ZodEnum<{
        blocks: "blocks";
        chart: "chart";
        files: "files";
        "git-branch": "git-branch";
        globe: "globe";
        sparkles: "sparkles";
    }>>;
    capabilities: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        "align.status": "align.status";
        "drift.analyze": "drift.analyze";
        "drift.importSession": "drift.importSession";
        "drift.recentSessions": "drift.recentSessions";
        "drift.render": "drift.render";
        "drift.validateTraces": "drift.validateTraces";
        "host.notify": "host.notify";
        "project.git": "project.git";
        "project.metadata": "project.metadata";
        "project.readText": "project.readText";
        "project.tree": "project.tree";
        "slide-gen.generate": "slide-gen.generate";
        "slide-gen.render": "slide-gen.render";
        "slide-gen.status": "slide-gen.status";
        "tree-complete.createFork": "tree-complete.createFork";
        "tree-complete.workspace": "tree-complete.workspace";
    }>>>;
}, z.core.$strict>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export declare const PluginProjectSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    color: z.ZodString;
    available: z.ZodBoolean;
}, z.core.$strict>;
export type PluginProject = z.infer<typeof PluginProjectSchema>;
export declare const ProjectMetadataSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    color: z.ZodString;
    available: z.ZodBoolean;
    displayPath: z.ZodString;
    branch: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>;
export declare const ProjectTreeParamsSchema: z.ZodObject<{
    depth: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export type ProjectTreeParams = z.input<typeof ProjectTreeParamsSchema>;
export declare const ProjectTreeEntrySchema: z.ZodObject<{
    path: z.ZodString;
    name: z.ZodString;
    kind: z.ZodEnum<{
        directory: "directory";
        file: "file";
        symlink: "symlink";
    }>;
    depth: z.ZodNumber;
    size: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export type ProjectTreeEntry = z.infer<typeof ProjectTreeEntrySchema>;
export declare const ProjectReadTextParamsSchema: z.ZodObject<{
    path: z.ZodString;
}, z.core.$strict>;
export declare const ProjectTextSchema: z.ZodObject<{
    path: z.ZodString;
    text: z.ZodString;
    truncated: z.ZodBoolean;
}, z.core.$strict>;
export type ProjectText = z.infer<typeof ProjectTextSchema>;
export declare const GitSummarySchema: z.ZodObject<{
    available: z.ZodBoolean;
    branch: z.ZodNullable<z.ZodString>;
    upstream: z.ZodNullable<z.ZodString>;
    ahead: z.ZodNumber;
    behind: z.ZodNumber;
    staged: z.ZodNumber;
    modified: z.ZodNumber;
    untracked: z.ZodNumber;
    clean: z.ZodBoolean;
}, z.core.$strict>;
export type GitSummary = z.infer<typeof GitSummarySchema>;
export declare const EventKindSchema: z.ZodEnum<{
    completed: "completed";
    failed: "failed";
    "needs-input": "needs-input";
    system: "system";
}>;
export type EventKind = z.infer<typeof EventKindSchema>;
export declare const NotificationInputSchema: z.ZodObject<{
    kind: z.ZodOptional<z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        "needs-input": "needs-input";
        system: "system";
    }>>;
    title: z.ZodString;
    body: z.ZodOptional<z.ZodString>;
    url: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type NotificationInput = z.input<typeof NotificationInputSchema>;
export declare const NotificationEventSchema: z.ZodObject<{
    id: z.ZodString;
    projectId: z.ZodNullable<z.ZodString>;
    kind: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        "needs-input": "needs-input";
        system: "system";
    }>;
    title: z.ZodString;
    body: z.ZodString;
    url: z.ZodString;
    createdAt: z.ZodString;
    readAt: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export type NotificationEvent = z.infer<typeof NotificationEventSchema>;
export declare const AlignStatusSchema: z.ZodObject<{
    initialized: z.ZodBoolean;
    contract: z.ZodObject<{
        state: z.ZodEnum<{
            accepted: "accepted";
            ambiguous: "ambiguous";
            missing: "missing";
            provisional: "provisional";
        }>;
        id: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
    latest: z.ZodObject<{
        stage: z.ZodNullable<z.ZodEnum<{
            candidate_final: "candidate_final";
            in_progress: "in_progress";
            pre_task: "pre_task";
            released: "released";
        }>>;
        assessmentCount: z.ZodNumber;
        reportCount: z.ZodNumber;
    }, z.core.$strict>;
    totals: z.ZodObject<{
        amendments: z.ZodNumber;
        assessments: z.ZodNumber;
        checkpoints: z.ZodNumber;
        contracts: z.ZodNumber;
        reports: z.ZodNumber;
        snapshots: z.ZodNumber;
    }, z.core.$strict>;
    nextAction: z.ZodNullable<z.ZodObject<{
        command: z.ZodString;
        reason: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type AlignStatus = z.infer<typeof AlignStatusSchema>;
export declare const DriftTracePathSchema: z.ZodString;
export declare const DriftAnalyzeRequestSchema: z.ZodObject<{
    path: z.ZodString;
}, z.core.$strict>;
export type DriftAnalyzeRequest = z.infer<typeof DriftAnalyzeRequestSchema>;
export declare const DriftValidateTracesRequestSchema: z.ZodObject<{
    paths: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type DriftValidateTracesRequest = z.infer<typeof DriftValidateTracesRequestSchema>;
export declare const DriftValidatedTracesSchema: z.ZodObject<{
    paths: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type DriftValidatedTraces = z.infer<typeof DriftValidatedTracesSchema>;
export declare const DriftRenderRequestSchema: z.ZodObject<{
    path: z.ZodString;
}, z.core.$strict>;
export declare const DriftRenderSchema: z.ZodObject<{
    path: z.ZodString;
    text: z.ZodString;
}, z.core.$strict>;
export type DriftRender = z.infer<typeof DriftRenderSchema>;
export declare const DriftCodexSessionIdSchema: z.ZodString;
export declare const DriftImportSessionRequestSchema: z.ZodObject<{
    sessionId: z.ZodString;
}, z.core.$strict>;
export type DriftImportSessionRequest = z.infer<typeof DriftImportSessionRequestSchema>;
export declare const DriftCodexSessionSchema: z.ZodObject<{
    id: z.ZodString;
    startedAt: z.ZodString;
    updatedAt: z.ZodString;
    source: z.ZodString;
    byteSize: z.ZodNumber;
}, z.core.$strict>;
export type DriftCodexSession = z.infer<typeof DriftCodexSessionSchema>;
export declare const DriftRecentSessionsSchema: z.ZodObject<{
    sessions: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        startedAt: z.ZodString;
        updatedAt: z.ZodString;
        source: z.ZodString;
        byteSize: z.ZodNumber;
    }, z.core.$strict>>;
    truncated: z.ZodBoolean;
}, z.core.$strict>;
export type DriftRecentSessions = z.infer<typeof DriftRecentSessionsSchema>;
export declare const DriftImportedSessionSchema: z.ZodObject<{
    path: z.ZodString;
    session: z.ZodObject<{
        id: z.ZodString;
        startedAt: z.ZodString;
        updatedAt: z.ZodString;
        source: z.ZodString;
        byteSize: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>;
export type DriftImportedSession = z.infer<typeof DriftImportedSessionSchema>;
export declare const TreeForkRequestSchema: z.ZodObject<{
    baseVersionId: z.ZodString;
    decisionId: z.ZodString;
    alternativeId: z.ZodString;
}, z.core.$strict>;
export type TreeForkRequest = z.infer<typeof TreeForkRequestSchema>;
export declare const TreeWorkspaceSchema: z.ZodObject<{
    project: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodString;
        repository: z.ZodString;
        defaultBranch: z.ZodString;
    }, z.core.$strict>;
    runner: z.ZodObject<{
        mode: z.ZodEnum<{
            codex: "codex";
            preview: "preview";
        }>;
        available: z.ZodBoolean;
        label: z.ZodString;
        detail: z.ZodString;
    }, z.core.$strict>;
    versions: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        parentId: z.ZodNullable<z.ZodString>;
        name: z.ZodString;
        branch: z.ZodString;
        commit: z.ZodString;
        createdAt: z.ZodString;
        status: z.ZodEnum<{
            complete: "complete";
            failed: "failed";
            queued: "queued";
            ready: "ready";
            working: "working";
        }>;
        summary: z.ZodString;
        decisions: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodString;
            question: z.ZodString;
            rationale: z.ZodString;
            chosenAlternativeId: z.ZodString;
            alternatives: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                label: z.ZodString;
                description: z.ZodString;
                impact: z.ZodString;
                agentBrief: z.ZodString;
                signal: z.ZodEnum<{
                    balanced: "balanced";
                    experimental: "experimental";
                    recommended: "recommended";
                }>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        forkOrigin: z.ZodOptional<z.ZodObject<{
            decisionId: z.ZodString;
            fromAlternativeId: z.ZodString;
            toAlternativeId: z.ZodString;
        }, z.core.$strict>>;
        runId: z.ZodOptional<z.ZodString>;
        changedFiles: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    runs: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        versionId: z.ZodString;
        mode: z.ZodEnum<{
            codex: "codex";
            preview: "preview";
        }>;
        phase: z.ZodEnum<{
            complete: "complete";
            failed: "failed";
            generating: "generating";
            preparing: "preparing";
            queued: "queued";
            verifying: "verifying";
        }>;
        progress: z.ZodNumber;
        startedAt: z.ZodString;
        completedAt: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        result: z.ZodOptional<z.ZodObject<{
            changeKind: z.ZodEnum<{
                measured: "measured";
                simulated: "simulated";
            }>;
            changedFileCount: z.ZodNumber;
            changedFiles: z.ZodArray<z.ZodString>;
            changedFilesTruncated: z.ZodBoolean;
            checks: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                label: z.ZodString;
                detail: z.ZodString;
                status: z.ZodEnum<{
                    passed: "passed";
                    simulated: "simulated";
                }>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        logs: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            at: z.ZodString;
            message: z.ZodString;
            tone: z.ZodEnum<{
                active: "active";
                error: "error";
                muted: "muted";
                success: "success";
            }>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    updatedAt: z.ZodString;
}, z.core.$strict>;
export type TreeWorkspace = z.infer<typeof TreeWorkspaceSchema>;
export declare const TreeForkResponseSchema: z.ZodObject<{
    runId: z.ZodString;
    versionId: z.ZodString;
    workspace: z.ZodObject<{
        project: z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            description: z.ZodString;
            repository: z.ZodString;
            defaultBranch: z.ZodString;
        }, z.core.$strict>;
        runner: z.ZodObject<{
            mode: z.ZodEnum<{
                codex: "codex";
                preview: "preview";
            }>;
            available: z.ZodBoolean;
            label: z.ZodString;
            detail: z.ZodString;
        }, z.core.$strict>;
        versions: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            parentId: z.ZodNullable<z.ZodString>;
            name: z.ZodString;
            branch: z.ZodString;
            commit: z.ZodString;
            createdAt: z.ZodString;
            status: z.ZodEnum<{
                complete: "complete";
                failed: "failed";
                queued: "queued";
                ready: "ready";
                working: "working";
            }>;
            summary: z.ZodString;
            decisions: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                title: z.ZodString;
                question: z.ZodString;
                rationale: z.ZodString;
                chosenAlternativeId: z.ZodString;
                alternatives: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    label: z.ZodString;
                    description: z.ZodString;
                    impact: z.ZodString;
                    agentBrief: z.ZodString;
                    signal: z.ZodEnum<{
                        balanced: "balanced";
                        experimental: "experimental";
                        recommended: "recommended";
                    }>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            forkOrigin: z.ZodOptional<z.ZodObject<{
                decisionId: z.ZodString;
                fromAlternativeId: z.ZodString;
                toAlternativeId: z.ZodString;
            }, z.core.$strict>>;
            runId: z.ZodOptional<z.ZodString>;
            changedFiles: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        runs: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            versionId: z.ZodString;
            mode: z.ZodEnum<{
                codex: "codex";
                preview: "preview";
            }>;
            phase: z.ZodEnum<{
                complete: "complete";
                failed: "failed";
                generating: "generating";
                preparing: "preparing";
                queued: "queued";
                verifying: "verifying";
            }>;
            progress: z.ZodNumber;
            startedAt: z.ZodString;
            completedAt: z.ZodOptional<z.ZodString>;
            error: z.ZodOptional<z.ZodString>;
            result: z.ZodOptional<z.ZodObject<{
                changeKind: z.ZodEnum<{
                    measured: "measured";
                    simulated: "simulated";
                }>;
                changedFileCount: z.ZodNumber;
                changedFiles: z.ZodArray<z.ZodString>;
                changedFilesTruncated: z.ZodBoolean;
                checks: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    label: z.ZodString;
                    detail: z.ZodString;
                    status: z.ZodEnum<{
                        passed: "passed";
                        simulated: "simulated";
                    }>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            logs: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                at: z.ZodString;
                message: z.ZodString;
                tone: z.ZodEnum<{
                    active: "active";
                    error: "error";
                    muted: "muted";
                    success: "success";
                }>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        updatedAt: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export type TreeForkResponse = z.infer<typeof TreeForkResponseSchema>;
export declare const SlideGenReceiptSchema: z.ZodObject<{
    operationId: z.ZodString;
    kind: z.ZodEnum<{
        generate: "generate";
        render: "render";
    }>;
    startedAt: z.ZodString;
    finishedAt: z.ZodString;
    sourceRevision: z.ZodNullable<z.ZodString>;
    deckSha256: z.ZodNullable<z.ZodString>;
    pdfSha256: z.ZodNullable<z.ZodString>;
    pageCount: z.ZodNumber;
}, z.core.$strict>;
export type SlideGenReceipt = z.infer<typeof SlideGenReceiptSchema>;
export declare const SlideGenStatusSchema: z.ZodObject<{
    projectId: z.ZodString;
    sourceAvailable: z.ZodBoolean;
    busy: z.ZodBoolean;
    deck: z.ZodNullable<z.ZodObject<{
        path: z.ZodString;
        sha256: z.ZodString;
    }, z.core.$strict>>;
    render: z.ZodNullable<z.ZodObject<{
        pdfPath: z.ZodString;
        sha256: z.ZodString;
        pageCount: z.ZodNumber;
    }, z.core.$strict>>;
    lastReceipt: z.ZodNullable<z.ZodObject<{
        operationId: z.ZodString;
        kind: z.ZodEnum<{
            generate: "generate";
            render: "render";
        }>;
        startedAt: z.ZodString;
        finishedAt: z.ZodString;
        sourceRevision: z.ZodNullable<z.ZodString>;
        deckSha256: z.ZodNullable<z.ZodString>;
        pdfSha256: z.ZodNullable<z.ZodString>;
        pageCount: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type SlideGenStatus = z.infer<typeof SlideGenStatusSchema>;
export declare const SlideGenOperationResultSchema: z.ZodObject<{
    receipt: z.ZodObject<{
        operationId: z.ZodString;
        kind: z.ZodEnum<{
            generate: "generate";
            render: "render";
        }>;
        startedAt: z.ZodString;
        finishedAt: z.ZodString;
        sourceRevision: z.ZodNullable<z.ZodString>;
        deckSha256: z.ZodNullable<z.ZodString>;
        pdfSha256: z.ZodNullable<z.ZodString>;
        pageCount: z.ZodNumber;
    }, z.core.$strict>;
    status: z.ZodObject<{
        projectId: z.ZodString;
        sourceAvailable: z.ZodBoolean;
        busy: z.ZodBoolean;
        deck: z.ZodNullable<z.ZodObject<{
            path: z.ZodString;
            sha256: z.ZodString;
        }, z.core.$strict>>;
        render: z.ZodNullable<z.ZodObject<{
            pdfPath: z.ZodString;
            sha256: z.ZodString;
            pageCount: z.ZodNumber;
        }, z.core.$strict>>;
        lastReceipt: z.ZodNullable<z.ZodObject<{
            operationId: z.ZodString;
            kind: z.ZodEnum<{
                generate: "generate";
                render: "render";
            }>;
            startedAt: z.ZodString;
            finishedAt: z.ZodString;
            sourceRevision: z.ZodNullable<z.ZodString>;
            deckSha256: z.ZodNullable<z.ZodString>;
            pdfSha256: z.ZodNullable<z.ZodString>;
            pageCount: z.ZodNumber;
        }, z.core.$strict>>;
    }, z.core.$strict>;
}, z.core.$strict>;
export type SlideGenOperationResult = z.infer<typeof SlideGenOperationResultSchema>;
export declare const PluginThemeSchema: z.ZodObject<{
    mode: z.ZodEnum<{
        dark: "dark";
        light: "light";
    }>;
    tokens: z.ZodRecord<z.ZodString, z.ZodString>;
}, z.core.$strict>;
export type PluginTheme = z.infer<typeof PluginThemeSchema>;
export declare const PluginContextSchema: z.ZodObject<{
    apiVersion: z.ZodLiteral<"1.0">;
    capabilities: z.ZodArray<z.ZodEnum<{
        "align.status": "align.status";
        "drift.analyze": "drift.analyze";
        "drift.importSession": "drift.importSession";
        "drift.recentSessions": "drift.recentSessions";
        "drift.render": "drift.render";
        "drift.validateTraces": "drift.validateTraces";
        "host.notify": "host.notify";
        "project.git": "project.git";
        "project.metadata": "project.metadata";
        "project.readText": "project.readText";
        "project.tree": "project.tree";
        "slide-gen.generate": "slide-gen.generate";
        "slide-gen.render": "slide-gen.render";
        "slide-gen.status": "slide-gen.status";
        "tree-complete.createFork": "tree-complete.createFork";
        "tree-complete.workspace": "tree-complete.workspace";
    }>>;
    project: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        color: z.ZodString;
        available: z.ZodBoolean;
    }, z.core.$strict>;
    theme: z.ZodObject<{
        mode: z.ZodEnum<{
            dark: "dark";
            light: "light";
        }>;
        tokens: z.ZodRecord<z.ZodString, z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>;
export type PluginContext = z.infer<typeof PluginContextSchema>;
export declare const PluginStatusSchema: z.ZodObject<{
    state: z.ZodOptional<z.ZodEnum<{
        attention: "attention";
        busy: "busy";
        error: "error";
        idle: "idle";
    }>>;
    badge: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export type PluginStatus = z.input<typeof PluginStatusSchema>;
export declare const PluginMethodSchemas: {
    readonly "project.metadata": {
        readonly params: z.ZodUndefined;
        readonly result: z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            color: z.ZodString;
            available: z.ZodBoolean;
            displayPath: z.ZodString;
            branch: z.ZodNullable<z.ZodString>;
        }, z.core.$strict>;
    };
    readonly "project.tree": {
        readonly params: z.ZodOptional<z.ZodObject<{
            depth: z.ZodOptional<z.ZodNumber>;
            limit: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        readonly result: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            name: z.ZodString;
            kind: z.ZodEnum<{
                directory: "directory";
                file: "file";
                symlink: "symlink";
            }>;
            depth: z.ZodNumber;
            size: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
    };
    readonly "project.readText": {
        readonly params: z.ZodObject<{
            path: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            path: z.ZodString;
            text: z.ZodString;
            truncated: z.ZodBoolean;
        }, z.core.$strict>;
    };
    readonly "project.git": {
        readonly params: z.ZodUndefined;
        readonly result: z.ZodObject<{
            available: z.ZodBoolean;
            branch: z.ZodNullable<z.ZodString>;
            upstream: z.ZodNullable<z.ZodString>;
            ahead: z.ZodNumber;
            behind: z.ZodNumber;
            staged: z.ZodNumber;
            modified: z.ZodNumber;
            untracked: z.ZodNumber;
            clean: z.ZodBoolean;
        }, z.core.$strict>;
    };
    readonly "host.notify": {
        readonly params: z.ZodObject<{
            kind: z.ZodOptional<z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                "needs-input": "needs-input";
                system: "system";
            }>>;
            title: z.ZodString;
            body: z.ZodOptional<z.ZodString>;
            url: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            id: z.ZodString;
            projectId: z.ZodNullable<z.ZodString>;
            kind: z.ZodEnum<{
                completed: "completed";
                failed: "failed";
                "needs-input": "needs-input";
                system: "system";
            }>;
            title: z.ZodString;
            body: z.ZodString;
            url: z.ZodString;
            createdAt: z.ZodString;
            readAt: z.ZodNullable<z.ZodString>;
        }, z.core.$strict>;
    };
    readonly "align.status": {
        readonly params: z.ZodUndefined;
        readonly result: z.ZodObject<{
            initialized: z.ZodBoolean;
            contract: z.ZodObject<{
                state: z.ZodEnum<{
                    accepted: "accepted";
                    ambiguous: "ambiguous";
                    missing: "missing";
                    provisional: "provisional";
                }>;
                id: z.ZodNullable<z.ZodString>;
            }, z.core.$strict>;
            latest: z.ZodObject<{
                stage: z.ZodNullable<z.ZodEnum<{
                    candidate_final: "candidate_final";
                    in_progress: "in_progress";
                    pre_task: "pre_task";
                    released: "released";
                }>>;
                assessmentCount: z.ZodNumber;
                reportCount: z.ZodNumber;
            }, z.core.$strict>;
            totals: z.ZodObject<{
                amendments: z.ZodNumber;
                assessments: z.ZodNumber;
                checkpoints: z.ZodNumber;
                contracts: z.ZodNumber;
                reports: z.ZodNumber;
                snapshots: z.ZodNumber;
            }, z.core.$strict>;
            nextAction: z.ZodNullable<z.ZodObject<{
                command: z.ZodString;
                reason: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>;
    };
    readonly "drift.render": {
        readonly params: z.ZodObject<{
            path: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            path: z.ZodString;
            text: z.ZodString;
        }, z.core.$strict>;
    };
    readonly "drift.validateTraces": {
        readonly params: z.ZodObject<{
            paths: z.ZodArray<z.ZodString>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            paths: z.ZodArray<z.ZodString>;
        }, z.core.$strict>;
    };
    readonly "drift.recentSessions": {
        readonly params: z.ZodUndefined;
        readonly result: z.ZodObject<{
            sessions: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                startedAt: z.ZodString;
                updatedAt: z.ZodString;
                source: z.ZodString;
                byteSize: z.ZodNumber;
            }, z.core.$strict>>;
            truncated: z.ZodBoolean;
        }, z.core.$strict>;
    };
    readonly "drift.importSession": {
        readonly params: z.ZodObject<{
            sessionId: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            path: z.ZodString;
            session: z.ZodObject<{
                id: z.ZodString;
                startedAt: z.ZodString;
                updatedAt: z.ZodString;
                source: z.ZodString;
                byteSize: z.ZodNumber;
            }, z.core.$strict>;
        }, z.core.$strict>;
    };
    readonly "drift.analyze": {
        readonly params: z.ZodObject<{
            path: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            path: z.ZodString;
            text: z.ZodString;
        }, z.core.$strict>;
    };
    readonly "tree-complete.workspace": {
        readonly params: z.ZodUndefined;
        readonly result: z.ZodObject<{
            project: z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                description: z.ZodString;
                repository: z.ZodString;
                defaultBranch: z.ZodString;
            }, z.core.$strict>;
            runner: z.ZodObject<{
                mode: z.ZodEnum<{
                    codex: "codex";
                    preview: "preview";
                }>;
                available: z.ZodBoolean;
                label: z.ZodString;
                detail: z.ZodString;
            }, z.core.$strict>;
            versions: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                parentId: z.ZodNullable<z.ZodString>;
                name: z.ZodString;
                branch: z.ZodString;
                commit: z.ZodString;
                createdAt: z.ZodString;
                status: z.ZodEnum<{
                    complete: "complete";
                    failed: "failed";
                    queued: "queued";
                    ready: "ready";
                    working: "working";
                }>;
                summary: z.ZodString;
                decisions: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    title: z.ZodString;
                    question: z.ZodString;
                    rationale: z.ZodString;
                    chosenAlternativeId: z.ZodString;
                    alternatives: z.ZodArray<z.ZodObject<{
                        id: z.ZodString;
                        label: z.ZodString;
                        description: z.ZodString;
                        impact: z.ZodString;
                        agentBrief: z.ZodString;
                        signal: z.ZodEnum<{
                            balanced: "balanced";
                            experimental: "experimental";
                            recommended: "recommended";
                        }>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                forkOrigin: z.ZodOptional<z.ZodObject<{
                    decisionId: z.ZodString;
                    fromAlternativeId: z.ZodString;
                    toAlternativeId: z.ZodString;
                }, z.core.$strict>>;
                runId: z.ZodOptional<z.ZodString>;
                changedFiles: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
            runs: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                versionId: z.ZodString;
                mode: z.ZodEnum<{
                    codex: "codex";
                    preview: "preview";
                }>;
                phase: z.ZodEnum<{
                    complete: "complete";
                    failed: "failed";
                    generating: "generating";
                    preparing: "preparing";
                    queued: "queued";
                    verifying: "verifying";
                }>;
                progress: z.ZodNumber;
                startedAt: z.ZodString;
                completedAt: z.ZodOptional<z.ZodString>;
                error: z.ZodOptional<z.ZodString>;
                result: z.ZodOptional<z.ZodObject<{
                    changeKind: z.ZodEnum<{
                        measured: "measured";
                        simulated: "simulated";
                    }>;
                    changedFileCount: z.ZodNumber;
                    changedFiles: z.ZodArray<z.ZodString>;
                    changedFilesTruncated: z.ZodBoolean;
                    checks: z.ZodArray<z.ZodObject<{
                        id: z.ZodString;
                        label: z.ZodString;
                        detail: z.ZodString;
                        status: z.ZodEnum<{
                            passed: "passed";
                            simulated: "simulated";
                        }>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                logs: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    at: z.ZodString;
                    message: z.ZodString;
                    tone: z.ZodEnum<{
                        active: "active";
                        error: "error";
                        muted: "muted";
                        success: "success";
                    }>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            updatedAt: z.ZodString;
        }, z.core.$strict>;
    };
    readonly "tree-complete.createFork": {
        readonly params: z.ZodObject<{
            baseVersionId: z.ZodString;
            decisionId: z.ZodString;
            alternativeId: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            runId: z.ZodString;
            versionId: z.ZodString;
            workspace: z.ZodObject<{
                project: z.ZodObject<{
                    id: z.ZodString;
                    name: z.ZodString;
                    description: z.ZodString;
                    repository: z.ZodString;
                    defaultBranch: z.ZodString;
                }, z.core.$strict>;
                runner: z.ZodObject<{
                    mode: z.ZodEnum<{
                        codex: "codex";
                        preview: "preview";
                    }>;
                    available: z.ZodBoolean;
                    label: z.ZodString;
                    detail: z.ZodString;
                }, z.core.$strict>;
                versions: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    parentId: z.ZodNullable<z.ZodString>;
                    name: z.ZodString;
                    branch: z.ZodString;
                    commit: z.ZodString;
                    createdAt: z.ZodString;
                    status: z.ZodEnum<{
                        complete: "complete";
                        failed: "failed";
                        queued: "queued";
                        ready: "ready";
                        working: "working";
                    }>;
                    summary: z.ZodString;
                    decisions: z.ZodArray<z.ZodObject<{
                        id: z.ZodString;
                        title: z.ZodString;
                        question: z.ZodString;
                        rationale: z.ZodString;
                        chosenAlternativeId: z.ZodString;
                        alternatives: z.ZodArray<z.ZodObject<{
                            id: z.ZodString;
                            label: z.ZodString;
                            description: z.ZodString;
                            impact: z.ZodString;
                            agentBrief: z.ZodString;
                            signal: z.ZodEnum<{
                                balanced: "balanced";
                                experimental: "experimental";
                                recommended: "recommended";
                            }>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                    forkOrigin: z.ZodOptional<z.ZodObject<{
                        decisionId: z.ZodString;
                        fromAlternativeId: z.ZodString;
                        toAlternativeId: z.ZodString;
                    }, z.core.$strict>>;
                    runId: z.ZodOptional<z.ZodString>;
                    changedFiles: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>;
                runs: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    versionId: z.ZodString;
                    mode: z.ZodEnum<{
                        codex: "codex";
                        preview: "preview";
                    }>;
                    phase: z.ZodEnum<{
                        complete: "complete";
                        failed: "failed";
                        generating: "generating";
                        preparing: "preparing";
                        queued: "queued";
                        verifying: "verifying";
                    }>;
                    progress: z.ZodNumber;
                    startedAt: z.ZodString;
                    completedAt: z.ZodOptional<z.ZodString>;
                    error: z.ZodOptional<z.ZodString>;
                    result: z.ZodOptional<z.ZodObject<{
                        changeKind: z.ZodEnum<{
                            measured: "measured";
                            simulated: "simulated";
                        }>;
                        changedFileCount: z.ZodNumber;
                        changedFiles: z.ZodArray<z.ZodString>;
                        changedFilesTruncated: z.ZodBoolean;
                        checks: z.ZodArray<z.ZodObject<{
                            id: z.ZodString;
                            label: z.ZodString;
                            detail: z.ZodString;
                            status: z.ZodEnum<{
                                passed: "passed";
                                simulated: "simulated";
                            }>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                    logs: z.ZodArray<z.ZodObject<{
                        id: z.ZodString;
                        at: z.ZodString;
                        message: z.ZodString;
                        tone: z.ZodEnum<{
                            active: "active";
                            error: "error";
                            muted: "muted";
                            success: "success";
                        }>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                updatedAt: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>;
    };
    readonly "slide-gen.status": {
        readonly params: z.ZodUndefined;
        readonly result: z.ZodObject<{
            projectId: z.ZodString;
            sourceAvailable: z.ZodBoolean;
            busy: z.ZodBoolean;
            deck: z.ZodNullable<z.ZodObject<{
                path: z.ZodString;
                sha256: z.ZodString;
            }, z.core.$strict>>;
            render: z.ZodNullable<z.ZodObject<{
                pdfPath: z.ZodString;
                sha256: z.ZodString;
                pageCount: z.ZodNumber;
            }, z.core.$strict>>;
            lastReceipt: z.ZodNullable<z.ZodObject<{
                operationId: z.ZodString;
                kind: z.ZodEnum<{
                    generate: "generate";
                    render: "render";
                }>;
                startedAt: z.ZodString;
                finishedAt: z.ZodString;
                sourceRevision: z.ZodNullable<z.ZodString>;
                deckSha256: z.ZodNullable<z.ZodString>;
                pdfSha256: z.ZodNullable<z.ZodString>;
                pageCount: z.ZodNumber;
            }, z.core.$strict>>;
        }, z.core.$strict>;
    };
    readonly "slide-gen.generate": {
        readonly params: z.ZodUndefined;
        readonly result: z.ZodObject<{
            receipt: z.ZodObject<{
                operationId: z.ZodString;
                kind: z.ZodEnum<{
                    generate: "generate";
                    render: "render";
                }>;
                startedAt: z.ZodString;
                finishedAt: z.ZodString;
                sourceRevision: z.ZodNullable<z.ZodString>;
                deckSha256: z.ZodNullable<z.ZodString>;
                pdfSha256: z.ZodNullable<z.ZodString>;
                pageCount: z.ZodNumber;
            }, z.core.$strict>;
            status: z.ZodObject<{
                projectId: z.ZodString;
                sourceAvailable: z.ZodBoolean;
                busy: z.ZodBoolean;
                deck: z.ZodNullable<z.ZodObject<{
                    path: z.ZodString;
                    sha256: z.ZodString;
                }, z.core.$strict>>;
                render: z.ZodNullable<z.ZodObject<{
                    pdfPath: z.ZodString;
                    sha256: z.ZodString;
                    pageCount: z.ZodNumber;
                }, z.core.$strict>>;
                lastReceipt: z.ZodNullable<z.ZodObject<{
                    operationId: z.ZodString;
                    kind: z.ZodEnum<{
                        generate: "generate";
                        render: "render";
                    }>;
                    startedAt: z.ZodString;
                    finishedAt: z.ZodString;
                    sourceRevision: z.ZodNullable<z.ZodString>;
                    deckSha256: z.ZodNullable<z.ZodString>;
                    pdfSha256: z.ZodNullable<z.ZodString>;
                    pageCount: z.ZodNumber;
                }, z.core.$strict>>;
            }, z.core.$strict>;
        }, z.core.$strict>;
    };
    readonly "slide-gen.render": {
        readonly params: z.ZodUndefined;
        readonly result: z.ZodObject<{
            receipt: z.ZodObject<{
                operationId: z.ZodString;
                kind: z.ZodEnum<{
                    generate: "generate";
                    render: "render";
                }>;
                startedAt: z.ZodString;
                finishedAt: z.ZodString;
                sourceRevision: z.ZodNullable<z.ZodString>;
                deckSha256: z.ZodNullable<z.ZodString>;
                pdfSha256: z.ZodNullable<z.ZodString>;
                pageCount: z.ZodNumber;
            }, z.core.$strict>;
            status: z.ZodObject<{
                projectId: z.ZodString;
                sourceAvailable: z.ZodBoolean;
                busy: z.ZodBoolean;
                deck: z.ZodNullable<z.ZodObject<{
                    path: z.ZodString;
                    sha256: z.ZodString;
                }, z.core.$strict>>;
                render: z.ZodNullable<z.ZodObject<{
                    pdfPath: z.ZodString;
                    sha256: z.ZodString;
                    pageCount: z.ZodNumber;
                }, z.core.$strict>>;
                lastReceipt: z.ZodNullable<z.ZodObject<{
                    operationId: z.ZodString;
                    kind: z.ZodEnum<{
                        generate: "generate";
                        render: "render";
                    }>;
                    startedAt: z.ZodString;
                    finishedAt: z.ZodString;
                    sourceRevision: z.ZodNullable<z.ZodString>;
                    deckSha256: z.ZodNullable<z.ZodString>;
                    pdfSha256: z.ZodNullable<z.ZodString>;
                    pageCount: z.ZodNumber;
                }, z.core.$strict>>;
            }, z.core.$strict>;
        }, z.core.$strict>;
    };
};
type MethodSchemas = typeof PluginMethodSchemas;
export type PluginMethodMap = {
    [Method in keyof MethodSchemas]: {
        params: z.input<MethodSchemas[Method]["params"]>;
        result: z.output<MethodSchemas[Method]["result"]>;
    };
};
export declare const PluginRpcRequestSchema: z.ZodObject<{
    method: z.ZodEnum<{
        "align.status": "align.status";
        "drift.analyze": "drift.analyze";
        "drift.importSession": "drift.importSession";
        "drift.recentSessions": "drift.recentSessions";
        "drift.render": "drift.render";
        "drift.validateTraces": "drift.validateTraces";
        "host.notify": "host.notify";
        "project.git": "project.git";
        "project.metadata": "project.metadata";
        "project.readText": "project.readText";
        "project.tree": "project.tree";
        "slide-gen.generate": "slide-gen.generate";
        "slide-gen.render": "slide-gen.render";
        "slide-gen.status": "slide-gen.status";
        "tree-complete.createFork": "tree-complete.createFork";
        "tree-complete.workspace": "tree-complete.workspace";
    }>;
    params: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strict>;
export type PluginRpcRequest = z.infer<typeof PluginRpcRequestSchema>;
export declare function parsePluginParams<Method extends PluginCapability>(method: Method, value: unknown): PluginMethodMap[Method]["params"];
export declare function parsePluginResult<Method extends PluginCapability>(method: Method, value: unknown): PluginMethodMap[Method]["result"];
export {};
