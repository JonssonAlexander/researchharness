import { pythonWorkbenchResponse } from "@/src/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    return pythonWorkbenchResponse(request, (await params).id);
}
export const POST = GET;
