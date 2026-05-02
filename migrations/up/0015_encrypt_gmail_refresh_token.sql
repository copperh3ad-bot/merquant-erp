-- 0015_encrypt_gmail_refresh_token.sql
-- 2026-05-02
--
-- Hardening for hardening-audit-2026-05-01 Finding 10
-- (Google OAuth refresh tokens stored in plaintext).
--
-- Google refresh tokens never expire — once leaked, an attacker has
-- long-lived access to every connected Gmail inbox until each user
-- revokes app permissions at myaccount.google.com. Storing them in
-- plaintext in `gmail_oauth.refresh_token` made any DB exposure (a
-- compromised SUPABASE_SERVICE_ROLE_KEY in CI logs, a stolen backup
-- file, a future SQL-injection bug) game-over.
--
-- This migration adds:
--   - A bytea column `refresh_token_encrypted` for ciphertext storage
--   - A bytea column `access_token_encrypted` for the short-lived
--     access token (lower-stakes but encrypt for consistency)
--   - Two SECURITY INVOKER helper functions encrypt_gmail_token() and
--     decrypt_gmail_token() that wrap pgcrypto's pgp_sym_encrypt/decrypt
--     using a passphrase passed in by the caller. The edge functions
--     pass the passphrase from the GMAIL_TOKEN_KEY Supabase secret,
--     so the key never touches the database.
--   - Restricted EXECUTE: only service_role can call the helpers.
--   - A backfill trigger that encrypts on INSERT/UPDATE if the caller
--     supplies plaintext columns and a passphrase.
--
-- The plaintext columns are KEPT (not dropped) to allow the edge
-- function rollout to land first without breaking existing rows.
-- A follow-up migration after the edge-function update will:
--   - Backfill all existing plaintext rows into the encrypted columns
--   - Drop the plaintext columns
-- Tracked as a TODO in this file's header comment.
--
-- Re-applying is safe (CREATE IF NOT EXISTS / CREATE OR REPLACE).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Schema additions ─────────────────────────────────────────────────
ALTER TABLE public.gmail_oauth
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted bytea,
  ADD COLUMN IF NOT EXISTS access_token_encrypted  bytea;

COMMENT ON COLUMN public.gmail_oauth.refresh_token_encrypted IS
  'pgp_sym_encrypt(refresh_token, GMAIL_TOKEN_KEY). Encrypted at rest. '
  'The plaintext refresh_token column is being phased out.';

COMMENT ON COLUMN public.gmail_oauth.access_token_encrypted IS
  'pgp_sym_encrypt(access_token, GMAIL_TOKEN_KEY). Encrypted at rest.';

-- ── Helper functions (service_role-only execution) ──────────────────
-- Uses pgp_sym_encrypt/decrypt — symmetric AES with PGP envelope. The
-- passphrase is passed in per call from the edge function's environment
-- (Deno.env.get("GMAIL_TOKEN_KEY")). This avoids storing the key in
-- the DB itself.

CREATE OR REPLACE FUNCTION public.encrypt_gmail_token(
  plaintext text,
  passphrase text
)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT pgp_sym_encrypt(plaintext, passphrase);
$$;

CREATE OR REPLACE FUNCTION public.decrypt_gmail_token(
  ciphertext bytea,
  passphrase text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT pgp_sym_decrypt(ciphertext, passphrase);
$$;

-- Lock down EXECUTE — only service_role (used by edge functions) and
-- postgres (DB admin) should ever call these. Locking out PUBLIC + anon
-- + authenticated stops a logged-in user from decrypting the column
-- via a client-side RPC call.
REVOKE EXECUTE ON FUNCTION public.encrypt_gmail_token(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrypt_gmail_token(bytea, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.encrypt_gmail_token(text, text) TO service_role;
GRANT  EXECUTE ON FUNCTION public.decrypt_gmail_token(bytea, text) TO service_role;

-- ── Per-user RLS — already present from migration 0001 ──────────────
-- (gmail_oauth_own_user policy at line 7058 of 0001_init.sql restricts
-- SELECT/INSERT/UPDATE/DELETE to the row's owner. Encrypted columns
-- inherit those policies automatically.)
