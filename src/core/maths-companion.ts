import { z } from "zod";
const text = (max: number) => z.string().trim().min(1).max(max);
export const webSourceUrl = z.string().url().max(2000).refine(value => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}, "Use a public HTTP(S) source URL without credentials.");
export const passageRect = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict();
export const researchSource = z.object({
    version: z.literal(1), id: z.string().regex(/^rs_[a-f0-9]{64}$/), hash: z.string().regex(/^[a-f0-9]{64}$/),
    title: text(300), authors: z.string().max(500), url: webSourceUrl, retrievedAt: z.string().datetime(),
    size: z.number().int().positive().max(25 * 1024 * 1024), pages: z.number().int().min(1).max(500),
}).strict();
export const researchPassage = z.object({
    version: z.literal(1), id: z.string().regex(/^rp_[a-f0-9]{64}$/), source: researchSource,
    page: z.number().int().min(1).max(500), reference: z.string().max(200), quote: text(1600),
    location: z.enum(["exact", "page-only"]), rects: z.array(passageRect).max(100),
}).strict();
export const findingAssessment = z.enum(["applicable", "specialization", "special-case", "technique", "analogy", "counterexample-candidate", "counterexample", "unresolved"]);
export const mathematicalFinding = z.object({
    title: text(160), claim: text(1200), relationship: text(1200), assumptions: text(1200),
    assessment: findingAssessment, nextStep: text(600), passageId: text(80),
}).strict();
export const mathematicalReport = z.object({ summary: text(1200), findings: z.array(mathematicalFinding).max(4), limitations: text(1600) }).strict();
export type ResearchSource = z.infer<typeof researchSource>;
export type ResearchPassage = z.infer<typeof researchPassage>;
export type MathematicalReport = z.infer<typeof mathematicalReport>;
export interface MathematicalInvestigation extends MathematicalReport {
    passages: ResearchPassage[];
}
export interface ResearchSourceStore {
 list?:(chatId:string)=>ResearchSource[];
    retain: (chatId: string, input: {
        title: string;
        authors: string;
        url: string;
        bytes: Uint8Array;
        pages: number;
    }) => ResearchSource;
    putPassage: (chatId: string, input: Omit<ResearchPassage, "id" | "version">) => ResearchPassage;
    passage: (chatId: string, id: string) => ResearchPassage;
    asset: (chatId: string, id: string) => {
        source: ResearchSource;
        bytes: Uint8Array;
    };
}
/** Stable, exact question/context comparison; it never declares mathematical equivalence. */
export function sameInvestigation(a: unknown, b: unknown): boolean {
    const key = (value: unknown) => {
        const v = value as {
            mode?: unknown;
            question?: unknown;
            context?: unknown;
        } | null;
        return v?.mode === "mathematical" && typeof v.question === "string" ? JSON.stringify([v.question.trim().replace(/\s+/g, " "), typeof v.context === "string" ? v.context.trim().replace(/\s+/g, " ") : ""]) : null;
    };
    const first = key(a);
    return first !== null && first === key(b);
}
