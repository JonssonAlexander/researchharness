import type { ReviewActivity } from "../core/retrieval.ts";
import { stores } from "./stores.ts";
import { startLesson } from "./learning-session.ts";
import { attachAtlasLearningContext, validateAtlasLearningContext } from "./atlas-sync.ts";

/** Explicit learning handoff; no teacher call, review rating or canonical write here. */
export function openReviewDiscussion(activity: ReviewActivity): string {
 if(activity.discussionChatId&&stores.chatStore.getChat(activity.discussionChatId))return activity.discussionChatId;
 const known=new Set(stores.atlasStore.read().concepts.map(c=>c.id));
 const conceptIds=[...new Set(activity.items.map(i=>i.conceptId))].filter(id=>known.has(id));
 const context=conceptIds.length?validateAtlasLearningContext({conceptIds,goal:"explain"}):undefined;
 const chat=stores.chatStore.createChat(`Review · ${activity.items.map(i=>i.title).join(" · ")}`.slice(0,160));
 const strong=stores.settingsStore.readSettings()?.models?.strong;
 if(strong?.model)stores.chatStore.saveSettings(chat.id,{model:strong.model,thinkingLevel:strong.thinkingLevel});
 if(context)attachAtlasLearningContext(chat.id,context);
 const lesson=startLesson(chat.id,"Understand and reconstruct this review solution",context);
 // A fixed target immediately makes the normal lesson scratchpad available.
 const plan={...lesson.plan,derivations:[{id:"review_solution",nodeId:lesson.plan.nodes[0]!.id,title:"Review question",start:"Use the definitions and assumptions in the review question. Work from your own attempt.",finish:activity.front,status:"working" as const}],activeDerivationId:"review_solution"};
 stores.lessonStore.save(chat.id,{expectedRevision:lesson.revision,status:"active",plan});
 return chat.id;
}
