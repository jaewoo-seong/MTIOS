import { NextResponse } from "next/server";
import { parseJson } from "@/lib/http";
import { findCompanyMatches } from "@/lib/company-research";
import { companyInputSchema } from "@/app/api/v1/companies/route";

import { guard } from "@/lib/api/guard";
export const POST = guard(async (request) => {
  const parsed = await parseJson(request, companyInputSchema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({ data: await findCompanyMatches(parsed.data) });
});
