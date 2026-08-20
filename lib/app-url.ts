export function getAppUrl(requestUrl?: string) {
  const configured = process.env.APP_URL?.trim();
  const candidate = configured || (requestUrl ? new URL(requestUrl).origin : "http://localhost:3000");
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("APP_URL must use http or https.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}
