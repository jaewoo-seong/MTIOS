import { NextResponse } from "next/server";
import { isValidWorkflowRequest } from "@/lib/internal-auth";
import { discoverMcpServer } from "@/lib/mcp/platform";

export async function POST(request: Request) {
  if (!isValidWorkflowRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ data: await discoverMcpServer() });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "MCP discovery failed."
    }, { status: 502 });
  }
}
