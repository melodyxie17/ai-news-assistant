const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const SCRAPE_TIMEOUT_MS = 25_000;
const CONTENT_LIMIT = 6_000;

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405, { Allow: "POST" });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Send one webpage URL as JSON." }, 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "Send one webpage URL as JSON." }, 400);
    }

    const fields = Object.keys(body);
    if (fields.length !== 1 || fields[0] !== "url") {
      return jsonResponse({ error: "Send exactly one URL field." }, 400);
    }

    const validatedUrl = validateWebUrl(body.url);
    if (!validatedUrl.ok) return jsonResponse({ error: validatedUrl.error }, 400);

    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        { error: "Page retrieval is not configured yet. Add FIRECRAWL_API_KEY on the server." },
        503,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

    try {
      const response = await fetch(FIRECRAWL_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: validatedUrl.url,
          formats: ["markdown"],
          onlyMainContent: true,
          maxAge: 172_800_000,
          blockAds: true,
        }),
        signal: controller.signal,
      });

      const result = await readJson(response);
      if (!response.ok || result.success === false) {
        return jsonResponse(
          { error: readableFirecrawlError(response.status, result?.error) },
          response.status >= 400 && response.status < 500 ? response.status : 502,
        );
      }

      const data = result.data ?? result;
      const metadata = data.metadata ?? {};
      return jsonResponse({
        title: limitText(metadata.title || validatedUrl.parsed.hostname, 240),
        domain: validatedUrl.parsed.hostname.replace(/^www\./, ""),
        url: validatedUrl.url,
        description: limitText(metadata.description || "", 500),
        content: limitText(data.markdown ?? data.content ?? "", CONTENT_LIMIT),
      });
    } catch (error) {
      const message =
        error?.name === "AbortError"
          ? "Page retrieval timed out. Please try again."
          : "Page retrieval could not reach Firecrawl. Please try again.";
      return jsonResponse({ error: message }, 502);
    } finally {
      clearTimeout(timer);
    }
  },
};

function validateWebUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: "A webpage URL is required." };
  }
  if (value.length > 2_048) return { ok: false, error: "The webpage URL is too long." };

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "Use an http:// or https:// webpage URL." };
    }
    if (!parsed.hostname || parsed.username || parsed.password) {
      return { ok: false, error: "Enter a public webpage URL without credentials." };
    }
    return { ok: true, parsed, url: parsed.toString() };
  } catch {
    return { ok: false, error: "Enter a valid public webpage URL." };
  }
}

function readableFirecrawlError(status, detail) {
  if (status === 401 || status === 403) return "Page retrieval is not authorized on the server.";
  if (status === 402) return "The Firecrawl account has no available credits.";
  if (status === 429) return "Page retrieval is busy or rate limited. Please try again shortly.";
  if (status === 400) return limitText(detail || "Firecrawl rejected this webpage URL.", 240);
  return "Firecrawl could not retrieve this page. Please try again.";
}

function limitText(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function jsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}
