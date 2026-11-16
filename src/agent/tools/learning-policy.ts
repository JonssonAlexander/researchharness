import { Type } from 'typebox';
import { z } from 'zod';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { decisionContext, evidenceInput, learningTarget, type LearningPolicyService } from '../../core/learning-policy.ts';
import { serverExecute } from '../tool-execute.ts';
/** Injected local tools; no extra model calls or graph-truth writes. */
export function learningPolicyTools(service: LearningPolicyService): Record<string, AgentTool<any>> {
    const target = Type.Unsafe<z.infer<typeof learningTarget>>(z.toJSONSchema(learningTarget)), decision = Type.Unsafe<z.infer<typeof decisionContext>>(z.toJSONSchema(decisionContext)), evidence = Type.Unsafe<z.infer<typeof evidenceInput>>(z.toJSONSchema(evidenceInput)), empty = Type.Object({ targetId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })) }, { additionalProperties: false });
    return {
        read_learning: { name: 'read_learning', label: 'Read learning context', description: 'Read agent-only targets, recent source-linked evidence, decisions and eligible learner message IDs. No mastery inferred from absence, graph coverage or engagement.', parameters: empty, execute: serverExecute('read_learning', empty, async (v) => service.read(v.targetId)) },
        set_learning_target: { name: 'set_learning_target', label: 'Save learning target', description: 'Create/update a meaningful task and criterion, not every node. Stable ID and increasing revision, actual lesson topics and source pages, existing prerequisite targets. Agent planning only; never canonical truth.', parameters: target, execute: serverExecute('set_learning_target', target, async (v) => service.target(v)) },
        choose_learning_action: { name: 'choose_learning_action', label: 'Choose teaching strategy', description: 'Record an inspectable teaching decision at meaningful strategy changes. Respect learner intent and prerequisites. Returns explain/predict/reconstruct/connect/challenge/retrieve/continue; no quiz gate, automatic mastery or fixed cadence.', parameters: decision, execute: serverExecute('choose_learning_action', decision, async (v) => service.decide(v)) },
        record_learning_evidence: { name: 'record_learning_evidence', label: 'Record submitted learning evidence', description: 'Record an AI assessment of submitted learner work using actual eligible message IDs. No tutor text or unsent drawings. Distinguish help, gaps and uncertainty. Stable receipt ID, optional supersedes assessment ID for correction. delayed requires an earlier observation at least one day ago.', parameters: evidence, execute: serverExecute('record_learning_evidence', evidence, async (v) => service.evidence(v)) }
    };
}
