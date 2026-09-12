const FIRECRAWL_CRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/crawl";
const PAGE_LIMIT = 25;
const START_TIMEOUT_MS = 20_000;

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405, { Allow: "POST" });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Send one public URL and an exploration depth." }, 400);
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 2 ||
      !("url" in body) ||
      !("depth" in body)
    ) {
      return jsonResponse({ error: "Send exactly one URL and one depth value." }, 400);
    }

    const validatedUrl = validatePublicWebUrl(body.url);
    if (!validatedUrl.ok) return jsonResponse({ error: validatedUrl.error }, 400);

    if (!Number.isInteger(body.depth) || body.depth < 1 || body.depth > 3) {
      return jsonResponse({ error: "Crawl depth must be 1, 2, or 3." }, 400);
    }

    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        { error: "Site exploration is not configured yet. Add FIRECRAWL_API_KEY on the server." },
        503,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), START_TIMEOUT_MS);

    try {
      const response = await fetch(FIRECRAWL_CRAWL_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: validatedUrl.url,
          maxDiscoveryDepth: body.depth,
          sitemap: "skip",
          crawlEntireDomain: true,
          allowExternalLinks: false,
          allowSubdomains: false,
          ignoreQueryParameters: true,
          ignoreRobotsTxt: false,
          limit: PAGE_LIMIT,
          excludePaths: [
            ".*(?:login|log-in|signin|sign-in|logout|account|auth).*",
            ".*\\.(?:pdf|zip|docx?|xlsx?|pptx?|csv)(?:\\?.*)?$",
          ],
          scrapeOptions: {
            formats: ["markdown"],
            onlyMainContent: true,
            removeBase64Images: true,
            blockAds: true,
            maxAge: 172_800_000,
          },
        }),
        signal: controller.signal,
      });
      const result = await readJson(response);

      if (!response.ok || result.success === false || !result.id) {
        return jsonResponse(
          { error: readableFirecrawlError(response.status) },
          response.status >= 400 && response.status < 500 ? response.status : 502,
        );
      }

      return jsonResponse({
        id: String(result.id),
        status: "started",
        url: validatedUrl.url,
        depth: body.depth,
        pageLimit: PAGE_LIMIT,
      });
    } catch (error) {
      const message =
        error?.name === "AbortError"
          ? "The crawl took too long to start. Please try again."
          : "Site exploration could not reach Firecrawl. Please try again.";
      return jsonResponse({ error: message }, 502);
    } finally {
      clearTimeout(timer);
    }
  },
};

function validatePublicWebUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: "A public webpage URL is required." };
  }
  if (value.length > 2_048) return { ok: false, error: "The webpage URL is too long." };

  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { ok: false, error: "Use an http:// or https:// webpage URL." };
    }
    if (!parsed.hostname || parsed.username || parsed.password || isPrivateHostname(parsed.hostname)) {
      return { ok: false, error: "Enter a public webpage URL without credentials or internal addresses." };
    }
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: "Enter a valid public webpage URL." };
  }
}

function isPrivateHostname(value) {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname.includes(".") && !hostname.includes(":")) return true;
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home")
  ) {
    return true;
  }
  if (
    hostname === "::1" ||
    hostname === "::" ||
    hostname.startsWith("::ffff:") ||
    /^f[cd][0-9a-f]{2}:/i.test(hostname) ||
    /^fe[89ab][0-9a-f]:/i.test(hostname)
  ) {
    return true;
  }

  const parts = hostname.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const octets = parts.map(Number);
    if (octets.some((octet) => octet > 255)) return true;
    return (
      octets[0] === 0 ||
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      octets[0] >= 224
    );
  }
  return false;
}

function readableFirecrawlError(status) {
  if (status === 401 || status === 403) return "Site exploration is not authorized on the server.";
  if (status === 402) return "The Firecrawl account has no available credits.";
  if (status === 429) return "Site exploration is busy or rate limited. Please try again shortly.";
  if (status === 400) return "Firecrawl rejected this crawl request.";
  return "The crawl could not be started. Please try again.";
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
