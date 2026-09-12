import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

const SOURCES = [
  { name: "WIRED", url: "https://www.wired.com/feed/tag/ai/latest/rss" },
  {
    name: "TechCrunch",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
  },
  { name: "VentureBeat", url: "https://venturebeat.com/category/ai/feed/" },
];

const ITEMS_PER_SOURCE = 6;
const MAX_ARTICLES = 18;
const FETCH_TIMEOUT_MS = 12_000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
});

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed." }, 405, { Allow: "GET" });
    }

    const settledFeeds = await Promise.allSettled(SOURCES.map(fetchSource));
    const articles = [];
    const errors = [];

    settledFeeds.forEach((result, index) => {
      if (result.status === "fulfilled") {
        articles.push(...result.value);
      } else {
        errors.push({
          source: SOURCES[index].name,
          message: readableFeedError(result.reason),
        });
      }
    });

    articles.sort((left, right) => dateValue(right.publishedAt) - dateValue(left.publishedAt));
    const limitedArticles = articles.slice(0, MAX_ARTICLES);

    if (limitedArticles.length === 0) {
      return jsonResponse(
        {
          error: "None of the RSS feeds could be loaded. Please try again shortly.",
          articles: [],
          errors,
        },
        502,
      );
    }

    return jsonResponse(
      { articles: limitedArticles, errors },
      200,
      { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" },
    );
  },
};

async function fetchSource(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(source.url, {
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "User-Agent": "AI-News-Assistant/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}.`);

    const parsed = parser.parse(await response.text());
    const entries = extractEntries(parsed);
    if (entries.length === 0) throw new Error("Feed contained no readable entries.");

    return entries
      .map((entry) => normalizeEntry(entry, source.name))
      .filter(Boolean)
      .slice(0, ITEMS_PER_SOURCE);
  } finally {
    clearTimeout(timer);
  }
}

function extractEntries(parsed) {
  const rssItems = parsed?.rss?.channel?.item ?? parsed?.channel?.item;
  const atomEntries = parsed?.feed?.entry;
  return asArray(rssItems ?? atomEntries);
}

function normalizeEntry(entry, source) {
  const title = cleanText(readText(entry?.title), 240);
  const url = readLink(entry);
  if (!title || !url) return null;

  const publishedValue =
    readText(entry?.pubDate) ||
    readText(entry?.published) ||
    readText(entry?.updated) ||
    readText(entry?.date);
  const summaryValue =
    readText(entry?.description) ||
    readText(entry?.summary) ||
    readText(entry?.encoded) ||
    readText(entry?.content);

  return {
    id: createHash("sha256").update(`${source}:${url}`).digest("hex").slice(0, 20),
    source,
    title,
    url,
    publishedAt: toIsoDate(publishedValue),
    summary: cleanText(summaryValue, 600),
  };
}

function readLink(entry) {
  const links = asArray(entry?.link);
  const preferredLink =
    links.find((link) => typeof link === "object" && link?.rel === "alternate") ?? links[0];
  const candidates = [
    typeof preferredLink === "object" ? preferredLink?.href : preferredLink,
    readText(preferredLink),
    readText(entry?.guid),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsedUrl = new URL(String(candidate).trim());
      if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
        return parsedUrl.toString();
      }
    } catch {
      // Try the next available link value.
    }
  }
  return "";
}

function readText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return readText(value[0]);
  if (typeof value === "object") {
    return readText(value["#text"] ?? value.__cdata ?? value.text ?? "");
  }
  return "";
}

function cleanText(value, maxLength) {
  const text = String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(x[\da-f]+|\d+);/gi, decodeNumericEntity)
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

function decodeNumericEntity(entity, code) {
  const value = code.toLowerCase().startsWith("x")
    ? Number.parseInt(code.slice(1), 16)
    : Number.parseInt(code, 10);
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : entity;
}

function toIsoDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function dateValue(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function readableFeedError(error) {
  if (error?.name === "AbortError") return "The feed timed out.";
  return error instanceof Error ? error.message : "The feed could not be loaded.";
}

function jsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
