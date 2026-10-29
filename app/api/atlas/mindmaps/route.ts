import { importMindmapResponse, archiveMindmapResponse, mindmapAssetResponse } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = importMindmapResponse;
export const PATCH = archiveMindmapResponse;
export const GET = mindmapAssetResponse;
