import { NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES } from "@/lib/documents/convert";
import { ingestDocument } from "@/lib/documents/intelligence";
import { repository } from "@/lib/repository";

export const runtime = "nodejs";
/** Conversion of a large PDF is CPU-bound; keep it off the static path. */
export const dynamic = "force-dynamic";

export async function GET() {
  const [data, folders] = await Promise.all([
    repository.listDocuments(),
    repository.listFolders()
  ]);
  return NextResponse.json({ data, folders });
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: "validation_error", detail: "Attach a file field." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "validation_error", detail: "File is empty." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "payload_too_large", detail: `Maximum upload size is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.` },
      { status: 413 }
    );
  }

  const folders = await repository.listFolders();
  const requestedFolderId = String(form.get("folderId") ?? "");
  const folder = folders.find((item) => item.id === requestedFolderId) ?? folders[0];
  if (!folder) {
    return NextResponse.json({ error: "no_folder", detail: "No destination folder exists." }, { status: 409 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const projectId = String(form.get("projectId") ?? "") || null;
  const result = await ingestDocument({
    folderId: folder.id,
    projectId,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    buffer,
    preferredLanguages: String(form.get("languages") ?? "en,ko").split(",").filter(Boolean)
  });

  return NextResponse.json({ data: result.document, conversion: result.conversion }, { status: 201 });
}
