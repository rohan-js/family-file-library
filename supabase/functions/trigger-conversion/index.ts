// Supabase Edge Function: trigger-conversion
// Dispatches a GitHub Actions repository_dispatch event when an office document or PDF is uploaded.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const GITHUB_REPO_OWNER = Deno.env.get("GITHUB_REPO_OWNER") ?? "";
const GITHUB_REPO_NAME = Deno.env.get("GITHUB_REPO_NAME") ?? "";
const GITHUB_PAT = Deno.env.get("GITHUB_PAT") ?? "";
const WEBHOOK_SECRET = Deno.env.get("CONVERSION_WEBHOOK_SECRET");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Supported extensions that trigger GitHub Actions conversion/extraction
const CONVERTIBLE_EXTENSIONS = [
  ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
  ".odt", ".ods", ".odp", ".rtf", ".pdf"
];

interface WebhookRecord {
  id?: string;
  file_id?: string;
  name?: string;
  file_name?: string;
  storage_path?: string;
  conversion_status?: string;
  status?: string;
  file_category?: string;
  file_type?: string;
  space_id?: string;
  [key: string]: unknown;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  try {
    // Authenticate via WEBHOOK_SECRET or SUPABASE_SERVICE_ROLE_KEY if configured
    const authHeader = req.headers.get("Authorization");
    if (WEBHOOK_SECRET || SUPABASE_SERVICE_ROLE_KEY) {
      const isSecretMatch = WEBHOOK_SECRET && authHeader === `Bearer ${WEBHOOK_SECRET}`;
      const isRoleKeyMatch = SUPABASE_SERVICE_ROLE_KEY && authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
      if (!isSecretMatch && !isRoleKeyMatch) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    const body = await req.json();
    // Support both Supabase Database Webhook { type, record } and direct invocation { file_id, name }
    const record: WebhookRecord = (body?.record ?? body) as WebhookRecord;

    const fileId = record?.id ?? record?.file_id;
    const fileName = record?.name ?? record?.file_name;
    const storagePath = record?.storage_path;
    const spaceId = record?.space_id;
    // Database schema uses `conversion_status`; tolerate legacy `status`
    const conversionStatus = record?.conversion_status ?? record?.status ?? "pending";

    if (!fileId || !fileName) {
      return new Response(JSON.stringify({ message: "No valid record found in payload (missing id or name)" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // Check if file qualifies for conversion/extraction
    const lowerName = fileName.toLowerCase();
    const isConvertible = CONVERTIBLE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));

    if (!isConvertible) {
      return new Response(
        JSON.stringify({ message: `Skipping: ${fileName} does not require conversion or text extraction` }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Only trigger if conversion_status is 'processing' or 'pending'
    if (conversionStatus !== "processing" && conversionStatus !== "pending") {
      return new Response(
        JSON.stringify({ message: `Skipping: conversion_status is '${conversionStatus}'` }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!GITHUB_REPO_OWNER || !GITHUB_REPO_NAME || !GITHUB_PAT) {
      throw new Error("Missing GitHub configuration in Edge Function environment variables.");
    }

    // Dispatch GitHub Actions workflow with 10s timeout
    const dispatchUrl = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/dispatches`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const dispatchResponse = await fetch(dispatchUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITHUB_PAT}`,
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Supabase-Conversion-Trigger"
      },
      body: JSON.stringify({
        event_type: "convert-document",
        client_payload: {
          file_id: fileId,
          file_name: fileName,
          name: fileName,
          storage_path: storagePath,
          space_id: spaceId,
          file_type: record?.file_type ?? record?.file_category
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!dispatchResponse.ok) {
      const errText = await dispatchResponse.text();
      throw new Error(`GitHub dispatch failed (${dispatchResponse.status}): ${errText}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        dispatched: true,
        file_id: fileId
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
