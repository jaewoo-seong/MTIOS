import { NextResponse } from "next/server";
import { z } from "zod";
import { resetOrganizationUserPassword } from "@/lib/admin-users";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { logger } from "@/lib/observability/logger";

const schema = z.object({ password: z.string().min(12).max(128) });

/**
 * `auth` tier rather than `standard`: this mints a credential for another
 * account, which makes it the most consequential endpoint an admin session can
 * reach.
 */
export const POST = guard<{ userId: string }>(async (request, { params, session }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const result = await resetOrganizationUserPassword(
    params.userId,
    session.userId,
    parsed.data.password
  );
  logger.info("admin.password_reset", {
    targetUserId: params.userId,
    actorId: session.userId
  });
  return NextResponse.json({ data: result });
}, { admin: true, rateLimit: "auth" });
