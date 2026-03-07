// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ReportResponse = {
  ethics_score: number;
  health_score: number;
  summary: string;
  better_swaps: string[];
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function isFresh(lastUpdated: string | null): boolean {
  if (!lastUpdated) return false;
  const updatedAtMs = new Date(lastUpdated).getTime();
  if (Number.isNaN(updatedAtMs)) return false;
  return Date.now() - updatedAtMs < 24 * 60 * 60 * 1000;
}

function extractExaText(payload: Record<string, unknown>): string {
  const results = Array.isArray(payload.results) ? payload.results : [];
  if (results.length === 0) return "No results returned from Exa.";

  return results
    .map((result, index) => {
      const entry = (result ?? {}) as Record<string, unknown>;
      const title = typeof entry.title === "string" ? entry.title : "";
      const text = typeof entry.text === "string" ? entry.text : "";
      const url = typeof entry.url === "string" ? entry.url : "";
      return `Result ${index + 1}\nTitle: ${title}\nURL: ${url}\nText: ${text}`;
    })
    .join("\n\n");
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
}

function clampScore(rawValue: number): number {
  return Math.min(10, Math.max(0, rawValue));
}

function normalizeScore(rawValue: unknown): number {
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue)) {
    throw new Error("Gemini response included a non-numeric score.");
  }

  const tenScaleValue = numericValue > 10 ? numericValue / 10 : numericValue;
  return clampScore(tenScaleValue);
}

function normalizeBrandKey(raw: string): string {
  return raw.trim().toLowerCase();
}

function filterBetterSwaps(swaps: string[], excludedBrands: string[]): string[] {
  const excludedSet = new Set(
    excludedBrands.map((brand) => normalizeBrandKey(brand)).filter((brand) => brand.length > 0),
  );
  return swaps.filter((swap) => !excludedSet.has(normalizeBrandKey(swap)));
}

function sanitizeReportResponse(
  report: Record<string, unknown>,
  excludedBrands: string[],
): Record<string, unknown> {
  const betterSwaps = Array.isArray(report.better_swaps)
    ? report.better_swaps.filter((item): item is string => typeof item === "string")
    : [];
  return {
    ...report,
    ethics_score: clampScore(Number(report.ethics_score)),
    health_score: clampScore(Number(report.health_score)),
    better_swaps: filterBetterSwaps(betterSwaps, excludedBrands),
  };
}

function parseModelJson(raw: string, excludedBrands: string[]): ReportResponse {
  const parsed = JSON.parse(stripCodeFences(raw)) as Partial<ReportResponse>;
  const ethicsScore = normalizeScore(parsed.ethics_score);
  const healthScore = normalizeScore(parsed.health_score);
  const roundedEthicsScore = clampScore(Number(ethicsScore.toFixed(1)));
  const roundedHealthScore = clampScore(Number(healthScore.toFixed(1)));
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  const betterSwaps = Array.isArray(parsed.better_swaps)
    ? parsed.better_swaps.filter((item): item is string => typeof item === "string")
    : [];

  if (!summary) {
    throw new Error("Gemini response did not match expected schema.");
  }

  return {
    ethics_score: roundedEthicsScore,
    health_score: roundedHealthScore,
    summary,
    better_swaps: filterBetterSwaps(betterSwaps, excludedBrands),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const body = await req.json();
    const brandName =
      typeof body?.brandName === "string" ? body.brandName.trim() : "";
    const comparingAgainst =
      typeof body?.comparingAgainst === "string"
        ? body.comparingAgainst.trim()
        : typeof body?.comparisonBrand === "string"
          ? body.comparisonBrand.trim()
          : "";
    const singlePreference =
      typeof body?.userPreference === "string" ? body.userPreference.trim() : "";
    const multiplePreferences = Array.isArray(body?.userPreferences)
      ? body.userPreferences
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [];
    const explicitPreferences =
      multiplePreferences.length > 0
        ? multiplePreferences
        : singlePreference
          ? [singlePreference]
          : [];
    const preferenceText = explicitPreferences.join(", ");
    const preferenceInstruction =
      explicitPreferences.length > 0
        ? `The user has specifically prioritized: ${preferenceText}. Adjust the ethics_score to reflect these priorities (60% weight) and ensure the summary explicitly addresses how the brand handles these specific areas.`
        : "Provide a General Ethical Overview based on standard ESG (Environmental, Social, and Governance) metrics.";
    const preferenceFallbackInstruction =
      explicitPreferences.length > 0
        ? `If you find no news related to a specific preference, state: "No specific data found for [Preference], falling back to general rating."`
        : "";
    const comparisonInstruction = comparingAgainst
      ? `If the user is comparing two brands, focus the "summary" on the specific differences between them. For example, if Brand A has better labor practices but Brand B has better environmental scores, highlight that trade-off.\n\nThe user is currently comparing against: ${comparingAgainst}.`
      : "";

    if (!brandName) {
      return jsonResponse({ error: "brandName is required." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const exaApiKey = Deno.env.get("EXA_API_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse(
        { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." },
        500,
      );
    }

    if (!exaApiKey || !geminiApiKey) {
      return jsonResponse(
        { error: "Missing EXA_API_KEY or GEMINI_API_KEY." },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: cachedReport, error: cacheError } = await supabase
      .from("brand_reports")
      .select("*")
      .eq("brand_name", brandName)
      .maybeSingle();

    if (cacheError) {
      return jsonResponse(
        { error: "Failed to read brand cache.", details: cacheError.message },
        500,
      );
    }

    if (cachedReport && isFresh(cachedReport.last_updated as string | null)) {
      return jsonResponse({
        source: "cache",
        data: sanitizeReportResponse(cachedReport, [brandName, comparingAgainst]),
      });
    }

    const exaPrompt =
      `Recent labor ethics, environmental impact, and corporate social responsibility news for ${brandName} in 2026`;

    const exaResponse = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${exaApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: exaPrompt,
        numResults: 5,
        useAutoprompt: true,
      }),
    });

    if (!exaResponse.ok) {
      const exaErrorText = await exaResponse.text();
      return jsonResponse(
        {
          error: "Exa request failed.",
          details: exaErrorText,
        },
        502,
      );
    }

    const exaPayload = (await exaResponse.json()) as Record<string, unknown>;
    const exaText = extractExaText(exaPayload);

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                    `You are rating a brand from recent news context.\n\nBrand: ${brandName}\n\n${preferenceInstruction}\n${preferenceFallbackInstruction}\n${comparisonInstruction}\n\nNews context:\n${exaText}\n\nRespond with ONLY valid JSON using this exact schema:\n{\n  "ethics_score": number,\n  "health_score": number,\n  "summary": "2 sentences",\n  "better_swaps": ["brand1", "brand2"]\n}\n\nDo not include markdown or extra commentary.`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
          },
        }),
      },
    );

    if (!geminiResponse.ok) {
      const geminiErrorText = await geminiResponse.text();
      return jsonResponse(
        {
          error: "Gemini request failed.",
          details: geminiErrorText,
        },
        502,
      );
    }

    const geminiPayload = await geminiResponse.json();
    const geminiText = geminiPayload?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (typeof geminiText !== "string") {
      return jsonResponse(
        { error: "Gemini response missing message content." },
        502,
      );
    }

    const parsed = parseModelJson(geminiText, [brandName, comparingAgainst]);
    const nowIso = new Date().toISOString();

    const reportToSave = {
      brand_name: brandName,
      ethics_score: parsed.ethics_score,
      health_score: parsed.health_score,
      summary: parsed.summary,
      better_swaps: parsed.better_swaps,
      last_updated: nowIso,
    };

    const { data: savedReport, error: upsertError } = await supabase
      .from("brand_reports")
      .upsert(reportToSave, { onConflict: "brand_name" })
      .select("*")
      .single();

    if (upsertError) {
      return jsonResponse(
        { error: "Failed to upsert report.", details: upsertError.message },
        500,
      );
    }

    return jsonResponse({
      source: "fresh",
      data: sanitizeReportResponse(savedReport, [brandName, comparingAgainst]),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: "Unhandled function error.", details: message }, 500);
  }
});
