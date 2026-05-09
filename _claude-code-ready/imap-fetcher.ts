/**
 * imap-fetcher.ts
 * 
 * IMAP email fetching for the email-crawler-agent.
 * Supports any IMAP server: Outlook, Yahoo, corporate mail, etc.
 * 
 * Uses imapflow (available via esm.sh in Deno)
 * Place at: supabase/functions/_shared/imap-fetcher.ts
 */

// @deno-types="https://esm.sh/imapflow@1.0.162/dist/imapflow.d.ts"
import { ImapFlow } from "https://esm.sh/imapflow@1.0.162";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ImapCredentials {
  host: string;
  port: number;
  secure: boolean;       // true = TLS (993), false = STARTTLS (143)
  username: string;
  password: string;      // app password or real password
}

export interface FetchedEmail {
  uid: string;
  messageId: string;
  subject: string;
  sender: string;
  body: string;
  receivedAt: string;
}

// ---------------------------------------------------------------------------
// Fetch unread emails via IMAP
// ---------------------------------------------------------------------------

export async function fetchUnreadEmailsImap(
  creds: ImapCredentials,
  maxEmails = 10
): Promise<FetchedEmail[]> {
  const client = new ImapFlow({
    host:   creds.host,
    port:   creds.port,
    secure: creds.secure,
    auth: {
      user: creds.username,
      pass: creds.password,
    },
    logger: false, // suppress verbose logs in prod
    tls: {
      rejectUnauthorized: true, // enforce cert validation
    },
  });

  const emails: FetchedEmail[] = [];

  try {
    await client.connect();

    // Open INBOX
    await client.mailboxOpen("INBOX");

    // Search for unseen messages
    const uids = await client.search({ seen: false }, { uid: true });
    if (!uids?.length) return [];

    // Take only the most recent N
    const toFetch = uids.slice(-maxEmails);

    for await (const msg of client.fetch(toFetch, {
      uid: true,
      envelope: true,
      bodyStructure: true,
      source: true,      // full RFC822 source for body parsing
    }, { uid: true })) {
      try {
        const subject  = msg.envelope?.subject ?? "";
        const fromAddr = msg.envelope?.from?.[0];
        const sender   = fromAddr
          ? `${fromAddr.name ?? ""} <${fromAddr.mailbox}@${fromAddr.host}>`.trim()
          : "";

        // Extract plain text from source
        const sourceText = msg.source?.toString() ?? "";
        const body = extractPlainTextFromRFC822(sourceText);

        emails.push({
          uid:        String(msg.uid),
          messageId:  msg.envelope?.messageId ?? String(msg.uid),
          subject,
          sender,
          body,
          receivedAt: msg.envelope?.date?.toISOString() ?? new Date().toISOString(),
        });
      } catch (msgErr) {
        console.error("[imap-fetcher] error parsing message:", msgErr);
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return emails;
}

// ---------------------------------------------------------------------------
// Mark emails as seen (read) by UID
// ---------------------------------------------------------------------------

export async function markEmailsAsReadImap(
  creds: ImapCredentials,
  uids: string[]
): Promise<void> {
  if (!uids.length) return;

  const client = new ImapFlow({
    host:   creds.host,
    port:   creds.port,
    secure: creds.secure,
    auth: { user: creds.username, pass: creds.password },
    logger: false,
  });

  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
  } finally {
    await client.logout().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Extract plain text from raw RFC822 email source
// Handles multipart/alternative, multipart/mixed, text/plain, text/html
// ---------------------------------------------------------------------------

function extractPlainTextFromRFC822(source: string): string {
  // Split headers from body
  const headerBodySplit = source.indexOf("\r\n\r\n");
  if (headerBodySplit === -1) return source.substring(0, 3000);

  const headers  = source.substring(0, headerBodySplit);
  const bodyRaw  = source.substring(headerBodySplit + 4);

  // Detect content type and boundary
  const ctMatch  = headers.match(/Content-Type:\s*([^\r\n;]+)/i);
  const ctValue  = ctMatch?.[1]?.trim().toLowerCase() ?? "";
  const boundary = headers.match(/boundary="?([^"\r\n;]+)"?/i)?.[1];

  // Plain multipart
  if (ctValue.startsWith("multipart/") && boundary) {
    return extractFromMultipart(bodyRaw, boundary);
  }

  // Plain text directly
  if (ctValue === "text/plain") {
    return decodeBodyPart(bodyRaw, headers).substring(0, 8000);
  }

  // HTML fallback — strip tags
  if (ctValue === "text/html") {
    return stripHtml(decodeBodyPart(bodyRaw, headers)).substring(0, 8000);
  }

  // Unknown — return raw truncated
  return bodyRaw.substring(0, 3000);
}

function extractFromMultipart(body: string, boundary: string): string {
  const parts = body.split(`--${boundary}`);
  let plainText = "";
  let htmlText  = "";

  for (const part of parts) {
    if (!part.trim() || part.trim() === "--") continue;

    const partHeaderEnd = part.indexOf("\r\n\r\n");
    if (partHeaderEnd === -1) continue;

    const partHeaders = part.substring(0, partHeaderEnd);
    const partBody    = part.substring(partHeaderEnd + 4);
    const partCT      = partHeaders.match(/Content-Type:\s*([^\r\n;]+)/i)?.[1]?.trim().toLowerCase() ?? "";
    const nestedBoundary = partHeaders.match(/boundary="?([^"\r\n;]+)"?/i)?.[1];

    if (partCT.startsWith("multipart/") && nestedBoundary) {
      const nested = extractFromMultipart(partBody, nestedBoundary);
      if (nested) plainText = nested;
    } else if (partCT === "text/plain") {
      plainText = decodeBodyPart(partBody, partHeaders);
    } else if (partCT === "text/html" && !plainText) {
      htmlText = stripHtml(decodeBodyPart(partBody, partHeaders));
    }
  }

  return (plainText || htmlText).substring(0, 8000);
}

function decodeBodyPart(body: string, headers: string): string {
  const encoding = headers.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase();

  if (encoding === "base64") {
    try {
      return atob(body.replace(/\s/g, ""));
    } catch {
      return body;
    }
  }

  if (encoding === "quoted-printable") {
    return decodeQuotedPrintable(body);
  }

  return body;
}

function decodeQuotedPrintable(str: string): string {
  return str
    .replace(/=\r\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Supabase helpers — get/store IMAP credentials
// ---------------------------------------------------------------------------

export async function getImapCredentials(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<ImapCredentials | null> {
  const { data, error } = await supabase
    .from("imap_credentials")
    .select("host, port, secure, username, encrypted_password")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) return null;

  // Decrypt password via Supabase Vault RPC
  const { data: decrypted, error: decryptErr } = await supabase
    .rpc("vault_decrypt_imap_password", { credential_id: data.id });

  if (decryptErr || !decrypted) {
    console.error("[imap-fetcher] vault decrypt failed:", decryptErr);
    return null;
  }

  return {
    host:     data.host,
    port:     data.port,
    secure:   data.secure,
    username: data.username,
    password: decrypted,
  };
}
