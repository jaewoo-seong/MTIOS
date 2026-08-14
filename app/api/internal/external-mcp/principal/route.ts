import { NextResponse } from "next/server";
import { authorizeExternalGatewayRequest, visibleExternalTools } from "@/lib/mcp/external-gateway";

export async function GET(request: Request) {
  const authorization = await authorizeExternalGatewayRequest(request);
  if ("error" in authorization) return authorization.error;
  const response = NextResponse.json({
    data: {
      credentialId: authorization.principal.credentialId,
      clientName: authorization.principal.clientName,
      tools: visibleExternalTools(authorization.principal).map((tool) => tool.name)
    }
  });
  for (const [key, value] of Object.entries(authorization.headers)) response.headers.set(key, value);
  return response;
}
