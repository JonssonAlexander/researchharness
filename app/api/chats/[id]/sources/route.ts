import {lessonDocumentsResponse} from '@/src/server';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return lessonDocumentsResponse(request,(await params).id);}
export const POST=GET;
