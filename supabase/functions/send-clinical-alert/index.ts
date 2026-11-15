const configuredOrigins = (Deno.env.get("APP_ORIGIN") || "https://medledger.ng")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  const permittedOrigin = origin && configuredOrigins.includes(origin)
    ? origin
    : (configuredOrigins[0] || "https://medledger.ng");

  return {
    "Access-Control-Allow-Origin": permittedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const json = (status: number, body: Record<string, unknown>, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
};

function getNamedSupabaseKey(variable: string, legacyVariable: string): string {
  const keyMapText = Deno.env.get(variable);
  if (keyMapText) {
    try {
      const keyMap = JSON.parse(keyMapText) as Record<string, unknown>;
      const defaultKey = keyMap.default;
      if (typeof defaultKey === "string" && defaultKey.length > 20) return defaultKey;
      throw new Error(`${variable} does not contain a valid default key`);
    } catch (error) {
      console.error(`Unable to read ${variable}`, error);
      throw new Error(`Invalid server key configuration: ${variable}`);
    }
  }

  // Compatibility fallback for projects that have not yet migrated from legacy keys.
  return requiredEnv(legacyVariable);
}

async function rest(
  path: string,
  secretKey: string,
  supabaseUrl: string,
  method = "GET",
  body?: unknown,
) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    signal: AbortSignal.timeout(8_000),
    headers: {
      // New Supabase secret keys are API keys, not JWTs: send them as apikey only.
      // A legacy service_role JWT also works in the apikey header for this server-side request.
      apikey: secretKey,
      ...(secretKey.startsWith("eyJ") ? { Authorization: `Bearer ${secretKey}` } : {}),
      "Content-Type": "application/json",
      ...(body !== undefined ? { Prefer: "return=representation" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const responseText = await response.text();
  if (!response.ok) {
    // Do not return database/provider details to the browser.
    console.error(`Supabase REST request failed (${response.status})`);
    throw new Error(`Supabase request failed (${response.status})`);
  }
  if (!responseText) return null;
  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error("Unexpected response from Supabase");
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (origin && !configuredOrigins.includes(origin)) {
    return new Response("Origin not allowed", { status: 403, headers: { "Vary": "Origin" } });
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, origin);

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json(415, { error: "Content-Type must be application/json" }, origin);
  }

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > 4_096) return json(413, { error: "Request is too large" }, origin);

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
    const publishableKey = getNamedSupabaseKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secretKey = getNamedSupabaseKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    const resendKey = requiredEnv("RESEND_API_KEY");
    const fromEmail = requiredEnv("RESEND_FROM_EMAIL");
    const appUrl = requiredEnv("APP_URL");

    const authorization = req.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return json(401, { error: "Sign-in required" }, origin);
    }

    // Verify the bearer token with Supabase Auth; do not trust an ID supplied by the browser.
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: publishableKey, Authorization: authorization },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!userResponse.ok) return json(401, { error: "Invalid or expired session" }, origin);
    const user = await userResponse.json();
    if (!user?.id) return json(401, { error: "Invalid session" }, origin);

    let payload: Record<string, unknown>;
    try {
      const rawBody = await req.text();
      if (new TextEncoder().encode(rawBody).byteLength > 4_096) {
        return json(413, { error: "Request is too large" }, origin);
      }
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json(400, { error: "Invalid request body" }, origin);
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      return json(400, { error: "Invalid JSON body" }, origin);
    }

    const facilityId = String(payload.facility_id || "");
    const eventType = String(payload.event_type || "");
    const recordId = String(payload.record_id || "");
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(facilityId) || !uuidPattern.test(recordId)) {
      return json(400, { error: "Invalid identifiers" }, origin);
    }
    if (!(["referral_created", "followup_scheduled"] as string[]).includes(eventType)) {
      return json(400, { error: "Unsupported alert type" }, origin);
    }

    // Check the user's active facility membership and role before using service-role access.
    const members = await rest(
      `facility_members?select=id&facility_id=eq.${facilityId}&user_id=eq.${user.id}&is_active=eq.true&role=in.(facility_admin,clinician)&limit=1`,
      secretKey,
      supabaseUrl,
    );
    if (!Array.isArray(members) || members.length !== 1) {
      return json(403, { error: "User is not authorised to send facility alerts" }, origin);
    }

    const recordTable = eventType === "referral_created" ? "referrals" : "follow_ups";
    const records = await rest(
      `${recordTable}?select=id&facility_id=eq.${facilityId}&id=eq.${recordId}&limit=1`,
      secretKey,
      supabaseUrl,
    );
    if (!Array.isArray(records) || records.length !== 1) {
      return json(404, { error: "Record not found in this facility" }, origin);
    }

    const facilities = await rest(
      `facilities?select=id,name,notification_email&id=eq.${facilityId}&limit=1`,
      secretKey,
      supabaseUrl,
    );
    const facility = Array.isArray(facilities) ? facilities[0] : null;
    if (!facility?.notification_email) {
      return json(200, { sent: false, reason: "Facility notification email is not configured" }, origin);
    }

    // Atomic per-user rate limit is enforced in Postgres under an advisory transaction lock.
    const quotaAllowed = await rest(
      "rpc/consume_email_alert_quota",
      secretKey,
      supabaseUrl,
      "POST",
      { p_facility_id: facilityId, p_actor_id: user.id, p_event_type: eventType },
    );
    if (quotaAllowed !== true) return json(429, { error: "Notification rate limit reached" }, origin);

    // Never include patient IDs, names, diagnoses, referral reasons or other health details.
    const label = eventType === "referral_created"
      ? "A referral has been recorded"
      : "A follow-up has been scheduled";
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail,
        to: [facility.notification_email],
        subject: `MedLedger update — ${facility.name}`,
        text: `${label} in the ${facility.name} workspace. Sign in to MedLedger to review the update: ${appUrl}\n\nThis alert intentionally contains no patient details.`,
      }),
      cache: "no-store",
    });

    if (!emailResponse.ok) {
      console.error(`Resend request failed (${emailResponse.status})`);
      return json(502, { error: "The notification provider could not send the alert" }, origin);
    }

    return json(200, { sent: true }, origin);
  } catch (error) {
    console.error("send-clinical-alert error", error);
    return json(500, { error: "Unable to process notification" }, origin);
  }
});
