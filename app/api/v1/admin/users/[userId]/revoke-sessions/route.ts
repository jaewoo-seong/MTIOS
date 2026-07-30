import { NextResponse } from "next/server";
import { revokeUserSessions } from "@/lib/auth";
import { guard } from "@/lib/api/guard";
import { logger } from "@/lib/observability/logger";

export const POST = guard<{ userId: string }>(async (_request, { params, session }) => {
  await revokeUserSessions(params.userId);
  logger.info("admin.sessions_revoked", {
    targetUserId: params.userId,
    actorId: session.userId
  });
  return NextResponse.json({ data: { revoked: true } });
}, { admin: true });
