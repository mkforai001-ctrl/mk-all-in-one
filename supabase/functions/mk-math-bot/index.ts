const DEFAULT_MODEL = "gemini-3.8-flash";
const MAX_MESSAGE_LENGTH = 4000;
const MAX_CONTEXT_MESSAGES = 8;
const MAX_CONTEXT_TEXT_LENGTH = 2000;
const MAX_BODY_BYTES = 24000;
const DEFAULT_ALLOWED_ORIGINS = [
  "https://mkforai001-ctrl.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const RATE_LIMIT_TIMEOUT_MS = 4000;
const PROVIDER_TIMEOUT_MS = 18000;

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function logStage(stage, startedAt, outcome) {
  // Log operational metadata only; never log prompts, IPs, credentials, or provider bodies.
  console.log(JSON.stringify({
    event: "mk_math_bot_stage",
    stage,
    outcome,
    duration_ms: Math.max(0, Date.now() - startedAt),
  }));
}

function jsonResponse(payload, status, corsHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function getAllowedOrigins(env) {
  const configured = env.get("MATH_BOT_ALLOWED_ORIGINS");
  if (!configured) return DEFAULT_ALLOWED_ORIGINS;
  return configured.split(",").map((item) => item.trim()).filter(Boolean);
}

function getClientIp(request) {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp && cloudflareIp.length <= 128) return cloudflareIp;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && realIp.length <= 128) return realIp;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const candidates = forwarded.split(",").map((item) => item.trim()).filter(Boolean);
    const candidate = candidates.at(-1);
    if (candidate && candidate.length <= 128) return candidate;
  }
  return null;
}

async function hashClientIp(ip, secret, cryptoImpl) {
  const encoder = new TextEncoder();
  const key = await cryptoImpl.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await cryptoImpl.subtle.sign("HMAC", key, encoder.encode(ip));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeContext(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_CONTEXT_MESSAGES).flatMap((item) => {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.text !== "string") return [];
    const text = item.text.trim().slice(0, MAX_CONTEXT_TEXT_LENGTH);
    if (!text) return [];
    return [{
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text }],
    }];
  });
}

function extractAnswer(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) continue;
    const answer = parts
      .filter((part) => typeof part?.text === "string")
      .map((part) => part.text)
      .join("")
      .trim();
    if (answer) return answer.slice(0, 12000);
  }
  return "";
}

export function createHandler({
  env = Deno.env,
  fetchImpl = fetch,
  cryptoImpl = globalThis.crypto,
} = {}) {
  return async function handleMathBotRequest(request) {
    const origin = request.headers.get("origin");
    const allowedOrigins = getAllowedOrigins(env);
    if (origin && !allowedOrigins.includes(origin)) {
      return jsonResponse({ error: "origin_not_allowed" }, 403);
    }

    const corsHeaders = {
      "Vary": "Origin",
      ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405, corsHeaders);
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonResponse({ error: "content_type_must_be_json" }, 415, corsHeaders);
    }

    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: "request_too_large" }, 413, corsHeaders);
    }

    let rawBody;
    try {
      rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
        return jsonResponse({ error: "request_too_large" }, 413, corsHeaders);
      }
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400, corsHeaders);
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400, corsHeaders);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "invalid_request" }, 400, corsHeaders);
    }
    if (typeof body.message !== "string" || !body.message.trim() || body.message.length > MAX_MESSAGE_LENGTH) {
      return jsonResponse({ error: "invalid_message" }, 400, corsHeaders);
    }
    const language = body.language === "ha" ? "ha" : body.language === "en" ? "en" : null;
    if (!language) return jsonResponse({ error: "invalid_language" }, 400, corsHeaders);

    const geminiApiKey = env.get("GEMINI_API_KEY");
    const supabaseUrl = env.get("SUPABASE_URL");
    const serviceRoleKey = env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!geminiApiKey || !supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "server_not_configured" }, 503, corsHeaders);
    }

    const ip = getClientIp(request);
    if (!ip) return jsonResponse({ error: "client_address_unavailable" }, 503, corsHeaders);

    let clientHash;
    try {
      clientHash = await hashClientIp(ip, serviceRoleKey, cryptoImpl);
    } catch {
      return jsonResponse({ error: "rate_limit_unavailable" }, 503, corsHeaders);
    }

    let rateLimit;
    try {
      const rateStartedAt = Date.now();
      const rateResponse = await fetchWithTimeout(
        fetchImpl,
        `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/consume_math_bot_rate_limit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": serviceRoleKey,
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ p_client_hash: clientHash }),
        },
        RATE_LIMIT_TIMEOUT_MS,
      );
      logStage("rate_limit", rateStartedAt, rateResponse.ok ? "ok" : "http_error");
      if (!rateResponse.ok) throw new Error("rate-limit-request-failed");
      const ratePayload = await rateResponse.json();
      rateLimit = Array.isArray(ratePayload) ? ratePayload[0] : ratePayload;
      if (!rateLimit || typeof rateLimit.allowed !== "boolean") throw new Error("invalid-rate-limit-response");
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "AbortError";
      return jsonResponse(
        { error: timedOut ? "rate_limit_timeout" : "rate_limit_unavailable" },
        timedOut ? 504 : 503,
        corsHeaders,
      );
    }

    if (!rateLimit.allowed) {
      const retryAfter = Number.isInteger(rateLimit.retry_after_seconds)
        ? Math.max(1, rateLimit.retry_after_seconds)
        : 60;
      return jsonResponse(
        { error: "rate_limit_exceeded", retryAfterSeconds: retryAfter },
        429,
        { ...corsHeaders, "Retry-After": String(retryAfter) },
      );
    }

    const model = (env.get("GEMINI_MODEL") || DEFAULT_MODEL).trim();
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) {
      return jsonResponse({ error: "invalid_model_configuration" }, 503, corsHeaders);
    }

    const context = normalizeContext(body.conversation);
    context.push({ role: "user", parts: [{ text: body.message.trim() }] });

    const systemInstruction = language === "ha"
      ? "Kai MK MATH BOT ne, mataimakin koyar da lissafi. Ka amsa da Hausa mai sauƙi. Ka warware lissafi mataki-mataki, ka nuna dabarar da aka yi amfani da ita, sannan ka tabbatar da sakamakon. Idan tambaya ba ta shafi lissafi ba, ka amsa a taƙaice kuma cikin ladabi. Kada ka ƙirƙiri bayanan da ba ka sani ba. Ka guji neman ko bayyana bayanan sirri."
      : "You are MK MATH BOT, a mathematics learning assistant. Reply in clear English. Explain calculations step by step, show the method, and verify the result. If a request is unrelated to mathematics, respond briefly and politely. Do not invent facts. Do not request or reveal private information.";

    let providerResponse;
    try {
      const providerStartedAt = Date.now();
      providerResponse = await fetchWithTimeout(
        fetchImpl,
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": geminiApiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: context,
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 2048,
            },
          }),
        },
        PROVIDER_TIMEOUT_MS,
      );
      logStage("gemini", providerStartedAt, providerResponse.ok ? "ok" : `http_${providerResponse.status}`);
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "AbortError";
      return jsonResponse(
        { error: timedOut ? "provider_timeout" : "provider_unavailable" },
        timedOut ? 504 : 502,
        corsHeaders,
      );
    }

    if (!providerResponse.ok) {
      const status = providerResponse.status === 429 ? 429 : 502;
      return jsonResponse(
        { error: status === 429 ? "provider_rate_limited" : "provider_unavailable" },
        status,
        status === 429 ? { ...corsHeaders, "Retry-After": "60" } : corsHeaders,
      );
    }

    let providerPayload;
    try {
      providerPayload = await providerResponse.json();
    } catch {
      return jsonResponse({ error: "invalid_provider_response" }, 502, corsHeaders);
    }

    const answer = extractAnswer(providerPayload);
    if (!answer) {
      return jsonResponse({ error: "empty_provider_response" }, 502, corsHeaders);
    }

    return jsonResponse({ answer, type: "math" }, 200, corsHeaders);
  };
}

if (import.meta.main) {
  Deno.serve(createHandler());
}
