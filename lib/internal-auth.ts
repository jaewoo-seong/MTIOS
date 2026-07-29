export function isValidWorkflowRequest(request: Request) {
  const secret = process.env.WORKFLOW_CALLBACK_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
