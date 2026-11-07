import { researchSourceResponse } from "@/src/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    return researchSourceResponse(request, (await params).id);
}
