const FIRECRAWL_CRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/crawl";
const PAGE_LIMIT = 25;
const EXCERPT_LIMIT = 700;
const STATUS_TIMEOUT_MS = 20_000;

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed." }, 405, { Allow: "GET" });
    }

    const id = new URL(request.url).searchParams.get("id") || "";
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(id)) {
      return jsonResponse({ error: "A valid crawl ID is required." }, 400);
    }

    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        { error: "Site exploration is not configured yet. Add FIRECRAWL_API_KEY on the server." },
        503,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);

    try {
      const response = await fetch(`${FIRECRAWL_CRAWL_ENDPOINT}/${encodeURIComponent(id)}`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });
      const result = await readJson(response);

      if (!response.ok) {
        return jsonResponse(
          { error: readableFirecrawlError(response.status) },
          response.status >= 400 && response.status < 500 ? response.status : 502,
        );
      }

      const status = normalizeStatus(result.status);
      const rawPages = Array.isArray(result.data) ? result.data.slice(0, PAGE_LIMIT) : [];
      const pages = rawPages.map(normalizePage).filter(Boolean);
      const reportedCompleted = safeCount(result.completed);
      const reportedTotal = safeCount(result.total);
      const pagesRetrieved = Math.min(
        PAGE_LIMIT,
        Math.max(reportedCompleted, pages.length),
      );
      const capReached =
        reportedCompleted >= PAGE_LIMIT || reportedTotal >= PAGE_LIMIT || rawPages.length >= PAGE_LIMIT;

      return jsonResponse({
        id,
        status,
        pagesRetrieved,
        total: Math.min(PAGE_LIMIT, Math.max(reportedTotal, pagesRetrieved)),
        pageLimit: PAGE_LIMIT,
        capReached,
        pages,
        error:
          status === "failed"
            ? "This site could not be cleanly crawled. Try another public website."
            : undefined,
      });
    } catch (error) {
      const message =
        error?.name === "AbortError"
          ? "The crawl status check timed out. Please try again."
          : "Crawl progress could not be checked. Please try again.";
      return jsonResponse({ error: message }, 502);
    } finally {
      clearTimeout(timer);
    }
  },
};

function normalizePage(value) {
  const page = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const metadata = page.metadata && typeof page.metadata === "object" ? page.metadata : {};
  const urlValue = metadata.sourceURL || metadata.url || "";

  let parsed;
  try {
    parsed = new URL(urlValue);
    if (!["http:", "https:"].includes(parsed.protocol) || isPrivateHostname(parsed.hostname)) return null;
  } catch {
    return null;
  }

  return {
    title: limitText(metadata.title || parsed.hostname, 240),
    url: parsed.toString(),
    excerpt: limitText(page.markdown || page.content || "", EXCERPT_LIMIT),
  };
}

function normalizeStatus(value) {
  if (value === "completed" || value === "failed") return value;
  return "scraping";
}

function safeCount(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
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
  if (status === 401 || status === 403) return "Crawl status is not authorized on the server.";
  if (status === 402) return "The Firecrawl account has no available credits.";
  if (status === 404) return "This crawl could not be found or has expired.";
  if (status === 429) return "Crawl status is temporarily rate limited. Please try again shortly.";
  return "Crawl progress could not be checked. Please try again.";
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
