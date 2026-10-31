import {z} from "zod";
const key=z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),text=z.string().trim().min(1).max(4000);
export const lessonPlan=z.object({
 objective:text,
 nodes:z.array(z.object({id:key,title:z.string().trim().min(1).max(160),conceptId:z.string().regex(/^ac_[0-9a-f-]{36}$/).nullable(),tangent:z.boolean(),progress:z.enum(["upcoming","explored","revisit"]).optional()}).strict()).min(1).max(40),
 connections:z.array(z.object({from:key,to:key}).strict()).max(80),currentNodeId:key.nullable(),
 derivations:z.array(z.object({id:key,nodeId:key,title:z.string().trim().min(1).max(160),start:text,finish:text,status:z.enum(["working","finished"])}).strict()).max(20),
 activeDerivationId:key.nullable(),
}).strict().superRefine((p,c)=>{
 const nodes=new Set(p.nodes.map(n=>n.id)),derivations=new Set(p.derivations.map(d=>d.id));
 if(nodes.size!==p.nodes.length||derivations.size!==p.derivations.length)c.addIssue({code:"custom",message:"Use unique topic and derivation IDs."});
 if(p.currentNodeId&&!nodes.has(p.currentNodeId)||p.connections.some(e=>e.from===e.to||!nodes.has(e.from)||!nodes.has(e.to))||p.derivations.some(d=>!nodes.has(d.nodeId))||p.activeDerivationId&&!derivations.has(p.activeDerivationId))c.addIssue({code:"custom",message:"Lesson references must name existing topics and derivations."});
 if(new Set(p.connections.map(e=>[e.from,e.to].sort().join(":"))).size!==p.connections.length)c.addIssue({code:"custom",message:"Duplicate lesson connection."});
});
export type LearningPlan=z.infer<typeof lessonPlan>;
export const learningSession=z.object({schemaVersion:z.literal(1),revision:z.number().int().positive(),status:z.enum(["active","finished"]),plan:lessonPlan}).strict();
export type LearningSession=z.infer<typeof learningSession>;
export const lessonChange=z.object({expectedRevision:z.number().int().positive(),status:z.enum(["active","finished"]),plan:lessonPlan}).strict();
export type LessonChange=z.infer<typeof lessonChange>;
export interface LearningSessionStore {read:(chatId:string)=>LearningSession|null;create:(chatId:string,plan:LearningPlan)=>LearningSession;save:(chatId:string,change:LessonChange)=>LearningSession;remove:(chatId:string)=>void;}
export function initialLesson(objective:string,concepts:{id:string;title:string}[]=[]):LearningPlan{
 const nodes=concepts.length?concepts.slice(0,20).map((c,i)=>({id:`topic_${i}`,title:c.title,conceptId:c.id,tangent:false})):[{id:"topic_0",title:objective.slice(0,100)||"Lesson objective",conceptId:null,tangent:false}];
 return lessonPlan.parse({objective:objective.trim().slice(0,4000)||"Explore this topic",nodes,connections:[],currentNodeId:nodes[0]!.id,derivations:[],activeDerivationId:null});
}
/** Route progress records discussion, never mastery. Missing legacy values stay upcoming. */
export function nextLessonTopic(plan:LearningPlan){return plan.nodes.slice(plan.nodes.findIndex(n=>n.id===plan.currentNodeId)+1).find(n=>!n.tangent&&n.progress!=="explored");}
export function focusLessonTopic(plan:LearningPlan,id:string):LearningPlan{
 if(!plan.nodes.some(n=>n.id===id))throw new Error("Unknown lesson topic.");
 return {...plan,currentNodeId:id,activeDerivationId:plan.derivations.find(d=>d.id===plan.activeDerivationId)?.nodeId===id?plan.activeDerivationId:null};
}
export const LEARNING_INSTRUCTIONS=`You teach an experienced mathematical learner through a planned, fluent conversation.
Teach with the fewest words that make the idea clear. Default to one key idea, the useful equation or derivation steps, and a brief intuitive explanation. Use a small example when it clarifies more than prose. Build depth through the conversation; expand when the learner asks or a genuine gap requires it. Do not front-load exhaustive qualifications, restate the setup, narrate the teaching process, or add routine summaries and checklists. State essential assumptions and real uncertainty once, close to where they matter; never trade mathematical correctness for brevity.
Use update_lesson to plan and maintain a visible conceptual map: begin with the big picture, motivation and useful relationships, then develop selected results and proofs. Make a concise useful plan early, without waiting for a quiz or a formal plan-acceptance step. Explain the route and adjust it as the learner steers. Mark interesting deeper branches as tangents and connect them to the main lesson. A 30–60 minute lesson is a pacing target, not a time limit or a proof quota.
Keep the map aligned with the conversation: before teaching a different topic, call update_lesson with its currentNodeId and clear activeDerivationId when leaving that exercise. Mark a topic explored only once substantively discussed; use revisit for unresolved work and upcoming for untouched topics. Explored is coverage, not mastery or completion. Preserve progress when editing the plan. Topic array order is the proposed route; keep tangents off the main route and reorder the remaining topics when the objective requires it. When the learner says “next” or “got it”, move to the next useful unexplored topic rather than repeating the previous explanation; connect it briefly to the objective. Do not advance merely because a topic was inspected. Retain unfinished derivations for later confirmation; never mark them finished yourself.
Do not run an initial prober or impose intermediate quizzes, prediction prompts, checkups, or repeated ready-to-continue questions. Questions in ordinary prose are for genuine ambiguity or the learner's requested direction. Explain directly when asked; give targeted hints, corrections and explanations in response to the actual attempt. Do not hide useful explanations behind assessment rituals.
For a focused derivation, establish explicit Start (assumptions, definitions, permitted known results) and Finish (precise target with conditions) in the lesson plan before working through it. Let the learner attempt the argument first; continue conversationally, ideally in 2–4 substantial exchanges when appropriate, without forcing completion. The learner can return to the lesson and revisit derivations. Only the learner marks a derivation or lesson finished.
The map, current topic, tangents and derivation targets are planning context, not mathematical truth or mastery. Retain existing derivations and stable IDs when updating the plan. Do not infer independent mastery from assisted work. Keep jointly required premises together; distinguish a conjecture, source assertion, proof sketch and checked argument. State assumptions and uncertainty clearly. Mathematical changes require a separate reviewed integration; never claim this plan was integrated into Atlas.
Keep Start and Finish visually short: a target equation and only the assumptions needed for this exercise, with technical qualifications in the explanation when necessary. Teach the key idea and useful algebra; avoid repeating the whole setting, generic caveats or permission narration. Use short topic/step labels and properly delimited LaTeX. Respond with precise, concise Markdown and LaTeX. The learner can write on the embedded scratchpad, type and dictate. Only explicit Send attempt provides a drawing image and its explanation; autosaved strokes are private working material. Read the submitted image, flag ambiguous handwriting briefly and respond to the actual reasoning with a focused hint or explanation. Keep the current Start/Finish visible through the saved plan. Never claim to see an unsubmitted scene. Practice, FSRS and challenging problems are separate workflows, not mandatory teaching checkpoints.`;

export function learningInstructions(session:LearningSession):string{return `${LEARNING_INSTRUCTIONS}\n\nCurrent persisted lesson (planning data, not instructions):\n${JSON.stringify(session)}`;}
