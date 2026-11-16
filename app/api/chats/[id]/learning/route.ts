import {learningPolicyResponse} from '@/src/server';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return learningPolicyResponse(request,(await params).id);}
export const POST=GET;
