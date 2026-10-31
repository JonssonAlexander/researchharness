import {lessonResponse} from "@/src/server";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return lessonResponse(request,(await params).id);}
export const PUT=GET;
