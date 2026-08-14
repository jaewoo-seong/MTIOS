import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/http";
import { authorizeExternalGatewayRequest, externalMcpErrorResponse, invokeExternalTool } from "@/lib/mcp/external-gateway";

const schema = z.object({
  toolName: z.string().trim().min(1).max(200),
  arguments: z.record(z.string(), z.unknown()).default({})
}).strict();

export async function POST(request: Request) {
  const authorization = await authorizeExternalGatewayRequest(request);
  if ("error" in authorization) return authorization.error;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    const data = await invokeExternalTool(authorization.principal, parsed.data.toolName, parsed.data.arguments ?? {});
    const response = NextResponse.json({ data });
    for (const [key, value] of Object.entries(authorization.headers)) response.headers.set(key, value);
    return response;
  } catch (error) {
    return externalMcpErrorResponse(error);
  }
}
