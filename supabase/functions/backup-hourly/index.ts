// supabase/functions/backup-hourly/index.ts
// Dumps every public table to a JSON file in Supabase Storage (bucket: backups)
// Structure: backups/YYYY-MM-DD/HHmm-table.json
// Keeps last 7 days (168 backups per table max)
//
// Trigger externally via: cron-job.org or GitHub Actions or Supabase scheduled jobs
// POST https://ecjqdyruwqlesfthgphv.supabase.co/functions/v1/backup-hourly
//   Headers: Authorization: Bearer <BACKUP_SECRET>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BACKUP_SECRET = Deno.env.get("BACKUP_SECRET") || "";

const TABLES_TO_BACKUP = [
  "purchase_orders", "po_items", "po_batches", "po_change_log",
  "articles", "master_articles", "tech_packs",
  "fabric_orders", "trim_items", "accessory_items",
  "samples", "sample_invoices", "lab_dips",
  "qc_inspections", "job_cards", "job_card_steps",
  "payments", "commercial_invoices", "costing_sheets",
  "suppliers", "buyer_contacts", "rfqs", "quotations",
  "tna_templates", "tna_calendars", "tna_milestones",
  "rm_stock", "style_consumption",
  "seasons", "sku_review_queue",
  "user_profiles", "signup_whitelist", "user_settings",
  "email_crawl_log", "gmail_oauth",
  "shipments", "packing_lists", "compliance_docs",
  "audit_log",
];

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function backupTable(tableName: string, prefix: string): Promise<{ ok: boolean; rows: number; path?: string; error?: string }> {
  try {
    const { data, error, count } = await admin
      .from(tableName)
      .select("*", { count: "exact" })
      .limit(100000);
    
    if (error) return { ok: false, rows: 0, error: error.message };
    
    const payload = {
      table: tableName,
      backup_at: new Date().toISOString(),
      row_count: count || 0,
      rows: data || [],
    };
    
    const path = `${prefix}/${tableName}.json`;
    const body = new TextEncoder().encode(JSON.stringify(payload));
    
    const { error: upErr } = await admin.storage
      .from("backups")
      .upload(path, body, {
        contentType: "application/json",
        upsert: true,
      });
    
    if (upErr) return { ok: false, rows: data?.length || 0, error: upErr.message };
    return { ok: true, rows: data?.length || 0, path };
  } catch (e) {
    return { ok: false, rows: 0, error: (e as Error).message };
  }
}

async function purgeOldBackups(daysToKeep = 7): Promise<number> {
  try {
    const { data: folders } = await admin.storage.from("backups").list("", { limit: 1000 });
    if (!folders) return 0;
    
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    
    let purged = 0;
    for (const folder of folders) {
      if (!folder.name || folder.name >= cutoffStr) continue;
      const { data: files } = await admin.storage.from("backups").list(folder.name, { limit: 1000 });
      if (files && files.length > 0) {
        const paths = files.map((f: any) => `${folder.name}/${f.name}`);
        await admin.storage.from("backups").remove(paths);
        purged += paths.length;
      }
    }
    return purged;
  } catch (e) {
    console.error("purge failed:", (e as Error).message);
    return 0;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  
  try {
    // Simple secret check
    const auth = req.headers.get("Authorization") || "";
    const providedSecret = auth.replace(/^Bearer\s+/i, "");
    if (BACKUP_SECRET && providedSecret !== BACKUP_SECRET) {
      return j({ error: "unauthorized" }, 401);
    }
    
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10);
    const timePart = now.toISOString().slice(11, 16).replace(":", "");
    const prefix = `${datePart}/${timePart}`;
    
    console.log(`[backup] starting run at ${prefix}`);
    
    const results: Record<string, any> = {};
    let totalRows = 0;
    let successCount = 0;
    let failureCount = 0;
    
    for (const table of TABLES_TO_BACKUP) {
      const r = await backupTable(table, prefix);
      results[table] = r;
      if (r.ok) {
        successCount++;
        totalRows += r.rows;
      } else {
        failureCount++;
        console.warn(`[backup] FAILED ${table}:`, r.error);
      }
    }
    
    // Purge backups older than 7 days
    const purged = await purgeOldBackups(7);
    
    const summary = {
      ok: true,
      backup_prefix: prefix,
      tables_backed_up: successCount,
      tables_failed: failureCount,
      total_rows: totalRows,
      old_files_purged: purged,
      timestamp: now.toISOString(),
    };
    
    // Log the backup run itself into audit_log (as system action)
    await admin.from("audit_log").insert({
      table_name: "_backup",
      action: "INSERT",
      user_email: "system:backup-hourly",
      record_id: prefix,
      new_data: summary,
    });
    
    console.log(`[backup] complete:`, summary);
    return j({ ...summary, details: results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[backup] exception:", msg);
    return j({ error: "internal", message: msg }, 500);
  }
});
