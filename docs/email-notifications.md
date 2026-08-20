# Gmail service sender and email notifications

MTI Business OS sends automated email from one administrator-controlled Gmail
mailbox. Individual users do not connect their own Gmail accounts for
notifications. Their account email address is the delivery address, and an
administrator can disable email notifications per user.

## Production setup

1. In a Google Cloud project controlled by MTI, enable the Gmail API and create
   an OAuth 2.0 web client.
2. Register exactly
   `https://<business-os-domain>/api/v1/integrations/gmail/callback` as an
   authorized redirect URI. `APP_URL` must use the same HTTPS origin.
3. Configure `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`, and a
   base64-encoded 32-byte `GMAIL_TOKEN_ENCRYPTION_KEY` on the app and every
   worker that imports the Gmail integration.
4. Deploy the database migration and Trigger.dev tasks before enabling the UI.
5. Sign in as a Business OS administrator, open Settings > Access, connect the
   MTI administrator mailbox, and choose **Use for notifications**.
6. Send a test notification to an MTI-controlled address. Confirm the sender,
   subject, body, and delivery record before enabling user notifications.

Only administrators can authorize, disconnect, or designate the service
sender. Refresh and access tokens are encrypted at rest and never returned by
the API. Rotating `GMAIL_TOKEN_ENCRYPTION_KEY` requires a planned token
re-encryption procedure; replacing it without re-encrypting stored tokens makes
existing connections unreadable.

## Google OAuth scope and verification

The same administrator connection supports the existing selected-thread and
draft features, so it requests `gmail.readonly`, `gmail.compose`, and
`gmail.send`. Gmail permits message sending with either `gmail.compose` or
`gmail.send`; the explicit send scope makes the service-sender permission
visible. Google recommends requesting the least privilege needed. If mailbox
reading and drafting are not required in a future deployment, introduce a
separate send-only authorization purpose rather than silently broadening a
notification-only connection.

Gmail scopes can require Google's OAuth verification and, depending on scope
classification and data handling, an additional security assessment for a
public application. A Google Workspace app configured as **Internal** and used
only by accounts in the same Workspace organization is generally exempt from
the public verification flow. Confirm the current requirements in Google's
[OAuth app verification documentation](https://support.google.com/cloud/answer/13463073)
and [Gmail API scope guide](https://developers.google.com/workspace/gmail/api/auth/scopes)
before production authorization.

## Delivery lifecycle

The first reusable event is `report.ready`. It is created once when a report
enters review, including reports produced by the workflow engine and external
MCP cross-project reporting. The default recipient is `report.createdBy`.

1. The event is inserted into `notification_outbox` with a unique deduplication
   key.
2. The request asks Trigger.dev to deliver it but does not fail the completed
   report if email dispatch is unavailable.
3. A production schedule sweeps due outbox rows every minute, covering dispatch
   failures and recovering claims left in `sending` for more than ten minutes.
4. Delivery uses the currently designated active service sender. Failures use
   exponential backoff and stop after five attempts unless an administrator
   explicitly retries an eligible row.
5. The admin Gmail panel displays recent delivery state without exposing OAuth
   tokens or message bodies.

The queue is idempotent at event creation and safely claims a row once per
attempt. Gmail's send endpoint does not provide an application idempotency key,
so an ambiguous network failure after Gmail accepts a message but before the
worker stores the response can result in at-least-once delivery. Notification
copy should therefore remain safe if a rare duplicate reaches the recipient.

## Adding notification events

Use `queueNotification` in `lib/notifications.ts`. A new event must provide:

- a stable event name;
- a deterministic deduplication key tied to the business transition;
- the recipient user's ID rather than a caller-supplied address;
- a source type and source ID for auditability;
- plain-text subject and body content containing no credentials or private
  internal diagnostics.

Queue the event only after its business transaction commits. Dispatch should
be best-effort because the scheduled outbox sweep is the recovery mechanism.
Do not call Gmail directly from feature routes.

## Operations

- If sending is revoked, reconnect the administrator mailbox and designate it
  again. Queued rows remain in the outbox.
- Investigate repeated `failed` rows using the sanitized error, Gmail API
  status, OAuth consent, and the service sender's Workspace policies.
- Revoke the Google grant and disconnect it in Business OS during a credential
  incident. Rotate the Google OAuth client secret separately from the token
  encryption key.
- Monitor failed/queued age and the Trigger.dev
  `email-notification-outbox-sweep` task. A growing queue indicates sender,
  worker, or Gmail API trouble.
