const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const MAX_SOURCES = 5;
const MAX_JOBS_PER_SOURCE = 8;
const MAX_RECOMMENDATIONS = 5;
const SCRAPE_TIMEOUT_MS = 45_000;

export const config = { maxDuration: 60 };

const EXTRACTION_PROMPT = `Extract up to 8 job opportunities visibly listed on this exact page. Focus on actual job postings, not navigation or promotional content. For each job return title, employer, location, direct job URL if visible, date, employment type, a short factual description, evidence that it is junior, graduate, entry-level, trainee, internship, assistant, associate, coordinator, analyst, 0–2 years experience, or no prior experience required; transferable skills; future-relevant technology, digital, data, policy, or innovation signals; learning or training signals; and any evidence that the role is actually senior. Do not infer unsupported facts. Use empty strings or arrays when evidence is unavailable.`;

const JOBS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["jobs"],
  properties: {
    jobs: {
      type: "array",
      maxItems: MAX_JOBS_PER_SOURCE,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "employer",
          "location",
          "jobUrl",
          "postedDate",
          "employmentType",
          "description",
          "juniorEvidence",
          "transferableSkills",
          "futureRelevantSignals",
          "learningSignals",
          "seniorityWarnings",
        ],
        properties: {
          title: { type: "string" },
          employer: { type: "string" },
          location: { type: "string" },
          jobUrl: { type: "string" },
          postedDate: { type: "string" },
          employmentType: { type: "string" },
          description: { type: "string" },
          juniorEvidence: { type: "array", items: { type: "string" } },
          transferableSkills: { type: "array", items: { type: "string" } },
          futureRelevantSignals: { type: "array", items: { type: "string" } },
          learningSignals: { type: "array", items: { type: "string" } },
          seniorityWarnings: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const EARLY_CAREER_SIGNALS = [
  "junior",
  "graduate",
  "entry-level",
  "entry level",
  "trainee",
  "internship",
  "intern",
  "assistant",
  "associate",
  "coordinator",
  "analyst",
  "0-2 years",
  "0–2 years",
  "no prior experience",
];

const SENIOR_TITLE_PATTERN = /\b(senior|lead|principal|head|director|executive|chief|vice president|vp)\b/i;
const SENIOR_EXPERIENCE_PATTERN = /\b(?:5|6|7|8|9|10)\+?\s*(?:years?|yrs?)\b/i;

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405, { Allow: "POST" });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Send an array containing 1 to 5 job-page URLs." }, 400);
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !("urls" in body)
    ) {
      return jsonResponse({ error: "Send exactly one urls array." }, 400);
    }

    const validated = validateSourceUrls(body.urls);
    if (!validated.ok) return jsonResponse({ error: validated.error }, 400);

    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        { error: "Job scanning is not configured yet. Add FIRECRAWL_API_KEY on the server." },
        503,
      );
    }

    const settled = await Promise.all(
      validated.urls.map((sourceUrl) => scanSource(sourceUrl, apiKey)),
    );
    const sourceSummaries = settled.map(({ jobs, ...source }) => source);
    const successfulSources = settled.filter((source) => source.status !== "failed");

    if (successfulSources.length === 0) {
      return jsonResponse(
        {
          error: "None of these pages could be cleanly extracted. Try another public job page.",
          sources: sourceSummaries,
          jobs: [],
        },
        502,
      );
    }

    const jobs = rankJobs(successfulSources.flatMap((source) => source.jobs));
    return jsonResponse({
      jobs,
      sources: sourceSummaries,
      message:
        jobs.length > 0
          ? `Found ${jobs.length} promising early-career ${jobs.length === 1 ? "role" : "roles"}.`
          : "No qualifying junior opportunities were found across these pages.",
    });
  },
};

async function scanSource(sourceUrl, apiKey) {
  const parsedSource = new URL(sourceUrl);
  const base = {
    url: sourceUrl,
    domain: stripWww(parsedSource.hostname),
  };
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
        url: sourceUrl,
        formats: [{ type: "json", schema: JOBS_SCHEMA, prompt: EXTRACTION_PROMPT }],
        onlyMainContent: true,
        maxAge: 172_800_000,
        blockAds: true,
        timeout: SCRAPE_TIMEOUT_MS,
      }),
      signal: controller.signal,
    });
    const result = await readJson(response);

    if (!response.ok || result.success === false) {
      return {
        ...base,
        status: "failed",
        jobCount: 0,
        message: readableSourceError(response.status),
        jobs: [],
      };
    }

    const extracted = result?.data?.json ?? result?.json ?? {};
    const rawJobs = Array.isArray(extracted?.jobs) ? extracted.jobs : [];
    const jobs = rawJobs
      .slice(0, MAX_JOBS_PER_SOURCE)
      .map((job) => normalizeJob(job, sourceUrl))
      .filter((job) => job.title);

    return jobs.length > 0
      ? {
          ...base,
          status: "extracted",
          jobCount: jobs.length,
          message: `Extracted ${jobs.length} visible ${jobs.length === 1 ? "job" : "jobs"}.`,
          jobs,
        }
      : {
          ...base,
          status: "no_jobs",
          jobCount: 0,
          message: "No usable job listings were found on this page.",
          jobs: [],
        };
  } catch (error) {
    return {
      ...base,
      status: "failed",
      jobCount: 0,
      message:
        error?.name === "AbortError"
          ? "This page took too long to extract. Try another public job page."
          : "This page could not be cleanly extracted. Try another public job page.",
      jobs: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

function validateSourceUrls(value) {
  if (!Array.isArray(value)) {
    return { ok: false, error: "Provide job-page URLs in an array." };
  }
  if (value.length < 1) return { ok: false, error: "Enter at least one job-page URL." };
  if (value.length > MAX_SOURCES) {
    return { ok: false, error: "Enter no more than 5 job-page URLs." };
  }
  if (value.some((item) => typeof item !== "string" || !item.trim())) {
    return { ok: false, error: "Every job-page URL must be a non-empty string." };
  }

  const supplied = value.map((item) => item.trim());

  const unique = [];
  const seen = new Set();
  for (const item of supplied) {
    if (item.length > 2_048) return { ok: false, error: "A job-page URL is too long." };

    let parsed;
    try {
      parsed = new URL(item.trim());
    } catch {
      return { ok: false, error: `Enter a valid public job-page URL: ${limitText(item, 100)}` };
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { ok: false, error: "Job-page URLs must start with http:// or https://." };
    }
    if (!parsed.hostname || parsed.username || parsed.password || isPrivateHostname(parsed.hostname)) {
      return { ok: false, error: "Use public job-page URLs without credentials or internal addresses." };
    }

    const normalized = parsed.toString();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(normalized);
    }
  }

  return { ok: true, urls: unique };
}

function isPrivateHostname(value) {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
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
    /^f[cd][0-9a-f]{2}:/i.test(hostname)
  ) {
    return true;
  }
  if (/^fe[89ab][0-9a-f]:/i.test(hostname)) return true;

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

function normalizeJob(value, sourceUrl) {
  const job = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    title: limitText(job.title, 180),
    employer: limitText(job.employer, 160),
    location: limitText(job.location, 160),
    jobUrl: normalizeJobUrl(job.jobUrl, sourceUrl),
    postedDate: limitText(job.postedDate, 100),
    employmentType: limitText(job.employmentType, 100),
    description: limitText(job.description, 600),
    juniorEvidence: normalizeStringArray(job.juniorEvidence, 4),
    transferableSkills: normalizeStringArray(job.transferableSkills, 6),
    futureRelevantSignals: normalizeStringArray(job.futureRelevantSignals, 5),
    learningSignals: normalizeStringArray(job.learningSignals, 5),
    seniorityWarnings: normalizeStringArray(job.seniorityWarnings, 4),
    sourceDomain: stripWww(new URL(sourceUrl).hostname),
  };
}

function normalizeJobUrl(value, sourceUrl) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(value.trim(), sourceUrl);
    return ["http:", "https:"].includes(parsed.protocol) && !isPrivateHostname(parsed.hostname)
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

function rankJobs(values) {
  const deduplicated = new Map();

  for (const job of values) {
    const analysis = analyzeJob(job);
    if (!analysis.accessibleEvidence || !analysis.skillsEvidence || !analysis.careerEvidence) continue;
    if (analysis.seniorityPenalty >= 70) continue;

    const key = job.jobUrl || [job.title, job.employer, job.location].map(normalizeKey).join("|");
    const candidate = {
      ...job,
      score: analysis.score,
      reasons: [
        { heading: "Accessible start", text: analysis.accessibleEvidence },
        { heading: "Skills you can build", text: analysis.skillsEvidence },
        { heading: "Career exposure", text: analysis.careerEvidence },
      ],
    };
    const existing = deduplicated.get(key);
    if (!existing || candidate.score > existing.score) deduplicated.set(key, candidate);
  }

  return [...deduplicated.values()]
    .sort((a, b) => b.score - a.score || dateValue(b.postedDate) - dateValue(a.postedDate))
    .slice(0, MAX_RECOMMENDATIONS)
    .map(({ score, ...job }, index) => ({ ...job, rank: index + 1 }));
}

function analyzeJob(job) {
  const titleAndDescription = `${job.title} ${job.description}`;
  const lowerText = titleAndDescription.toLowerCase();
  const titleSignal = EARLY_CAREER_SIGNALS.find((signal) => job.title.toLowerCase().includes(signal));
  const textSignals = EARLY_CAREER_SIGNALS.filter((signal) => lowerText.includes(signal));

  const accessibilityScore = Math.min(
    100,
    (titleSignal ? 60 : 0) + Math.min(job.juniorEvidence.length, 3) * 18 + textSignals.length * 8,
  );
  const skillsScore = Math.min(100, job.transferableSkills.length * 25);
  const futureScore = Math.min(100, job.futureRelevantSignals.length * 30);
  const learningScore = Math.min(100, job.learningSignals.length * 35);
  const seniorityPenalty =
    (SENIOR_TITLE_PATTERN.test(job.title) ? 90 : 0) +
    (SENIOR_EXPERIENCE_PATTERN.test(lowerText) ? 70 : 0) +
    Math.min(job.seniorityWarnings.length, 3) * 35;
  const score = Math.round(
    accessibilityScore * 0.4 + skillsScore * 0.3 + futureScore * 0.2 + learningScore * 0.1 - seniorityPenalty,
  );

  const accessibleEvidence = job.juniorEvidence[0]
    ? limitText(job.juniorEvidence[0], 220)
    : titleSignal
      ? `The job title explicitly uses the early-career signal “${titleSignal}.”`
      : "";
  const skillsEvidence = job.transferableSkills.length
    ? `The listing identifies ${joinEvidence(job.transferableSkills)}.`
    : "";
  const careerSignals = job.futureRelevantSignals.length
    ? job.futureRelevantSignals
    : job.learningSignals;
  const careerEvidence = careerSignals.length
    ? `The listing highlights ${joinEvidence(careerSignals)}.`
    : "";

  return { score, seniorityPenalty, accessibleEvidence, skillsEvidence, careerEvidence };
}

function joinEvidence(values) {
  const selected = values.slice(0, 3).map((value) => limitText(value, 90));
  if (selected.length === 1) return selected[0];
  if (selected.length === 2) return `${selected[0]} and ${selected[1]}`;
  return `${selected[0]}, ${selected[1]}, and ${selected[2]}`;
}

function normalizeStringArray(value, limit) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => limitText(item, 180)).filter(Boolean))].slice(0, limit);
}

function readableSourceError(status) {
  if (status === 401 || status === 403) return "Job scanning is not authorized on the server.";
  if (status === 402) return "The Firecrawl account has no available credits.";
  if (status === 429) return "This source is temporarily rate limited. Try it again shortly.";
  return "This page could not be cleanly extracted. Try another public job page.";
}

function dateValue(value) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function stripWww(value) {
  return String(value || "").replace(/^www\./i, "");
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
