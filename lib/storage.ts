import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const endpoint = process.env.RAILWAY_BUCKET_ENDPOINT;
const bucket = process.env.RAILWAY_BUCKET_NAME;
const accessKeyId = process.env.RAILWAY_BUCKET_ACCESS_KEY_ID;
const secretAccessKey = process.env.RAILWAY_BUCKET_SECRET_ACCESS_KEY;

export const storage = endpoint && bucket && accessKeyId && secretAccessKey
  ? new S3Client({
      endpoint,
      region: process.env.RAILWAY_BUCKET_REGION ?? "auto",
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey }
    })
  : null;

export async function checkStorage() {
  if (!storage || !bucket) return "not_configured";
  await storage.send(new HeadBucketCommand({ Bucket: bucket }));
  return "ok";
}

export async function storeReportExport(reportId: string, title: string, content: string) {
  if (!storage || !bucket) throw new Error("Railway Storage Bucket is not configured.");
  const key = `reports/${reportId}/${Date.now()}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
  await storage.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: content,
    ContentType: "text/markdown; charset=utf-8"
  }));
  const url = await getSignedUrl(storage, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: 900
  });
  return { key, url, expiresIn: 900, format: "markdown" };
}

export async function storeBinaryObject(key: string, contentType: string, body: Buffer) {
  if (!storage || !bucket) throw new Error("Railway Storage Bucket is not configured.");
  await storage.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType
  }));
  return { key, size: body.byteLength, contentType };
}
