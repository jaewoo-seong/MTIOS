import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { guard } from "@/lib/api/guard";
import { requireDatabase } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";
import {
  createOrganizationProfileDraft,
  listOrganizationProfileVersions
} from "@/lib/organization-profile";

export const GET = guard(async (_request, { session }) => {
  return NextResponse.json({ data: await listOrganizationProfileVersions(session.organizationId) });
}, { admin: true });

export const POST = guard(async (_request, { session }) => {
  const db = requireDatabase();
  const [organization] = await db.select({ name: organizations.name }).from(organizations)
    .where(eq(organizations.id, session.organizationId)).limit(1);
  const draft = await createOrganizationProfileDraft(
    session.organizationId,
    session.userId,
    organization?.name ?? "MTI"
  );
  return NextResponse.json({ data: draft }, { status: 201 });
}, { admin: true });
