import { z } from "zod";
export const pythonInput = z.object({
    title: z.string().trim().min(1).max(120),
    code: z.string().min(1).max(40000),
    parameters: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()])).default({}),
    seed: z.number().int().min(0).max(4294967295).default(0),
    timeout: z.number().int().min(1).max(120).default(60),
});
export type PythonInput = z.infer<typeof pythonInput>;
export interface PythonProject {
    path: string;
    interpreter: string;
    network: boolean;
}
export interface PythonRun {
    id: string;
    chatId: string;
    title: string;
    project: PythonProject;
    code: string;
    parameters: PythonInput["parameters"];
    seed: number;
    timeout: number;
    startedAt: string;
    finishedAt?: string;
    status: "running" | "done" | "error" | "interrupted";
    command?: string[];
    executionDirectory?: string;
    environmentVariables?: Record<string, string>;
    codeHash: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    outputs: {
        name: string;
        sha256: string;
        bytes: number;
    }[];
    environment?: {
        python: string;
        executable: string;
        platform: string;
        packages: string[];
    };
    inputs: {
        name: string;
        sha256: string;
        bytes: number;
    }[];
    limitations: string[];
    kept: boolean;
}
export interface PythonResult {
    runId: string;
    title: string;
    status: PythonRun["status"];
    stdout: string;
    stderr: string;
    outputs: PythonRun["outputs"];
}
export interface PythonWorkbench {
    project(chatId: string): PythonProject | null;
    read(chatId: string, runId: string): PythonRun;
    list(chatId: string): PythonRun[];
    run(chatId: string, runId: string, input: PythonInput, signal: AbortSignal): Promise<PythonResult>;
}
