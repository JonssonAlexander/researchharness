import {scratchpadResponse} from "@/src/server";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Context){return scratchpadResponse(request,(await params).id);}
export const PUT=GET;
export const POST=GET;
