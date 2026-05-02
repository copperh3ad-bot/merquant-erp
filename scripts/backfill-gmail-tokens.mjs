// Backfills the encrypted columns on existing gmail_oauth rows by
// reading the plaintext columns and writing the ciphertext via the
// encrypt_gmail_token RPC. Run AFTER 0015 + edge-function deploy +
// GMAIL_TOKEN_KEY secret are in place.
//
// Idempotent: rows whose refresh_token_encrypted is already non-null
// are skipped.

import { readFileSync } from "node:fs";

const PROJECTS = {
  tokyo:  "jcbxmpgjirxqszodotmx",
  mumbai: "ecjqdyruwqlesfthgphv",
};

const targetArg = process.argv[2];
const refs = targetArg ? [PROJECTS[targetArg]].filter(Boolean) : Object.values(PROJECTS);

const token = readFileSync(".supabase-token", "utf8").trim();

// Run a single transaction per project: encrypt every plaintext row
// where the encrypted column is still null.
const SQL = `
DO $$
DECLARE
  rec record;
  enc bytea;
  key text := current_setting('app.gmail_token_key', true);
BEGIN
  IF key IS NULL OR key = '' THEN
    RAISE EXCEPTION 'app.gmail_token_key not set; pass via SET LOCAL';
  END IF;
  FOR rec IN
    SELECT user_id, refresh_token, access_token
      FROM public.gmail_oauth
      WHERE (refresh_token_encrypted IS NULL OR access_token_encrypted IS NULL)
        AND (refresh_token IS NOT NULL OR access_token IS NOT NULL)
  LOOP
    UPDATE public.gmail_oauth
       SET refresh_token_encrypted = COALESCE(
             refresh_token_encrypted,
             CASE WHEN rec.refresh_token IS NOT NULL
                  THEN public.encrypt_gmail_token(rec.refresh_token, key)
                  ELSE NULL END),
           access_token_encrypted  = COALESCE(
             access_token_encrypted,
             CASE WHEN rec.access_token IS NOT NULL
                  THEN public.encrypt_gmail_token(rec.access_token, key)
                  ELSE NULL END),
           updated_at = now()
     WHERE user_id = rec.user_id;
  END LOOP;
END $$;
SELECT count(*) AS rows_with_encrypted FROM public.gmail_oauth WHERE refresh_token_encrypted IS NOT NULL;
SELECT count(*) AS rows_without_encrypted FROM public.gmail_oauth WHERE refresh_token IS NOT NULL AND refresh_token_encrypted IS NULL;
`;

for (const ref of refs) {
  const label = Object.entries(PROJECTS).find(([, v]) => v === ref)?.[0] ?? ref;
  console.log(`\n→ ${label} (${ref})`);

  // Pull the GMAIL_TOKEN_KEY from secrets so the SQL DO block can use it.
  // Set it via SET LOCAL so it never leaves the connection scope.
  // The Management API doesn't expose secrets directly, so we read the
  // env via the server's view of secrets — we need to pass the key in
  // the SQL itself. Wrap the body in SET LOCAL.
  const tokenKey = process.env.GMAIL_TOKEN_KEY;
  if (!tokenKey) {
    console.error(`  ✗ pass GMAIL_TOKEN_KEY env var to backfill`);
    process.exitCode = 1;
    continue;
  }
  const wrappedSql = `SET LOCAL app.gmail_token_key = ${pgQuote(tokenKey)};\n${SQL}`;

  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: wrappedSql }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`  ✗ backfill failed: ${body}`);
    process.exitCode = 1;
    continue;
  }
  console.log(`  ✓ backfill done`);
  console.log(`    ${body}`);
}

function pgQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}
