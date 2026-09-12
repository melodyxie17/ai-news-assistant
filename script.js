const loadButton = document.querySelector("#load-news");
const filterInput = document.querySelector("#news-filter");
const statusElement = document.querySelector("#news-status");
const articleList = document.querySelector("#article-list");
const deepReadPanel = document.querySelector("#deep-read-panel");
const deepReadContent = document.querySelector("#deep-read-content");
const webExplorerForm = document.querySelector("#web-explorer-form");
const webPageUrlInput = document.querySelector("#web-page-url");
const exploreDepthSelect = document.querySelector("#explore-depth");
const scrapePageButton = document.querySelector("#scrape-page");
const webExplorerStatus = document.querySelector("#web-explorer-status");
const webExplorerResult = document.querySelector("#web-explorer-result");
const jobScoutForm = document.querySelector("#job-scout-form");
const jobSourceInputs = [...document.querySelectorAll(".job-source-input")];
const jobSourceStatuses = [...document.querySelectorAll("[data-source-status]")];
const scanJobsButton = document.querySelector("#scan-jobs");
const clearJobResultsButton = document.querySelector("#clear-job-results");
const jobScoutStatus = document.querySelector("#job-scout-status");
const jobResults = document.querySelector("#job-results");
const jobResultList = document.querySelector("#job-result-list");

let loadedArticles = [];
const MAX_CRAWL_POLLS = 90;
const CRAWL_POLL_DELAY_MS = 2_000;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

loadButton.addEventListener("click", loadNews);
filterInput.addEventListener("input", renderFilteredArticles);
webExplorerForm.addEventListener("submit", runWebExplorer);
jobScoutForm.addEventListener("submit", runJobScout);
clearJobResultsButton.addEventListener("click", clearJobResults);

async function loadNews() {
  setLoadState(true);
  setStatus("Contacting the three RSS feeds…");
  articleList.replaceChildren();

  try {
    const response = await fetch("/api/news", {
      headers: { Accept: "application/json" },
    });
    const result = await readJson(response);

    if (!response.ok) {
      throw new Error(result.error || "The news feeds could not be loaded.");
    }

    loadedArticles = Array.isArray(result.articles) ? result.articles : [];
    filterInput.disabled = false;
    renderFilteredArticles();

    const failedSources = Array.isArray(result.errors) ? result.errors : [];
    if (failedSources.length > 0) {
      const names = failedSources.map((item) => item.source).join(", ");
      setStatus(
        `Loaded ${loadedArticles.length} stories. ${names} could not be reached this time.`,
        true,
      );
    } else {
      setStatus(`Loaded ${loadedArticles.length} stories from all three feeds.`);
    }
  } catch (error) {
    loadedArticles = [];
    filterInput.disabled = true;
    renderEmptyState(error.message || "The news feeds could not be loaded.");
    setStatus(
      `${error.message || "The news feeds could not be loaded."} Please try again.`,
      true,
    );
  } finally {
    setLoadState(false);
  }
}

function renderFilteredArticles() {
  const query = filterInput.value.trim().toLocaleLowerCase();
  const visibleArticles = loadedArticles.filter((article) => {
    const searchableText = `${article.title} ${article.summary}`.toLocaleLowerCase();
    return searchableText.includes(query);
  });

  articleList.replaceChildren();

  if (visibleArticles.length === 0) {
    renderEmptyState(
      loadedArticles.length === 0
        ? "No stories are loaded yet."
        : `No loaded stories match “${filterInput.value.trim()}”.`,
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleArticles.forEach((article) => fragment.append(createArticleCard(article)));
  articleList.append(fragment);
}

function createArticleCard(article) {
  const card = document.createElement("article");
  card.className = "article-card";

  const header = document.createElement("div");
  header.className = "article-card-header";

  const source = document.createElement("p");
  source.className = "source-label";
  source.textContent = article.source;

  const date = document.createElement("time");
  date.className = "article-date";
  date.textContent = formatDate(article.publishedAt);
  if (article.publishedAt) date.dateTime = article.publishedAt;

  header.append(source, date);

  const title = document.createElement("h3");
  title.textContent = article.title;

  const summary = document.createElement("p");
  summary.className = "article-summary";
  summary.textContent = article.summary || "No RSS summary was provided for this story.";

  const actions = document.createElement("div");
  actions.className = "article-actions";

  const originalLink = document.createElement("a");
  originalLink.className = "original-link";
  originalLink.href = article.url;
  originalLink.target = "_blank";
  originalLink.rel = "noopener noreferrer";
  originalLink.textContent = "Read Original Article ↗";

  const deepReadButton = document.createElement("button");
  deepReadButton.className = "deep-read-button";
  deepReadButton.type = "button";
  deepReadButton.textContent = "Deep Read";
  deepReadButton.addEventListener("click", () => runDeepRead(article));

  actions.append(originalLink, deepReadButton);
  card.append(header, title, summary, actions);
  return card;
}

async function runDeepRead(article) {
  setDeepReadButtonsDisabled(true);
  showDeepReadLoading(article);

  try {
    const response = await fetch("/api/scrape", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: article.url }),
    });
    const result = await readJson(response);

    if (!response.ok) {
      throw new Error(result.error || "Deep Read could not retrieve this page.");
    }

    showDeepReadResult(result);
  } catch (error) {
    showDeepReadError(article, error.message || "Deep Read could not retrieve this page.");
  } finally {
    setDeepReadButtonsDisabled(false);
  }
}

function showDeepReadLoading(article) {
  deepReadPanel.hidden = false;
  deepReadContent.replaceChildren();

  const title = document.createElement("h3");
  title.id = "deep-read-title";
  title.textContent = `Reading: ${article.title}`;

  const message = document.createElement("p");
  message.className = "panel-source";
  message.textContent = "Firecrawl is retrieving this selected article…";

  deepReadContent.append(title, message);
  deepReadPanel.focus({ preventScroll: true });
}

function showDeepReadResult(result) {
  deepReadContent.replaceChildren();

  const title = document.createElement("h3");
  title.id = "deep-read-title";
  title.textContent = result.title;

  const source = document.createElement("p");
  source.className = "panel-source";
  source.textContent = result.description
    ? `${result.domain} — ${result.description}`
    : result.domain;

  const content = document.createElement("pre");
  content.className = "panel-content";
  content.textContent = result.content || "No readable article text was returned.";

  const link = document.createElement("a");
  link.className = "panel-link";
  link.href = result.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Open Original Article ↗";

  deepReadContent.append(title, source, content, link);
}

function showDeepReadError(article, message) {
  deepReadContent.replaceChildren();

  const title = document.createElement("h3");
  title.id = "deep-read-title";
  title.textContent = `Could not retrieve: ${article.title}`;

  const errorMessage = document.createElement("p");
  errorMessage.className = "panel-source";
  errorMessage.textContent = `${message} You can try Deep Read again.`;

  const link = document.createElement("a");
  link.className = "panel-link";
  link.href = article.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Read the original article instead ↗";

  deepReadContent.append(title, errorMessage, link);
}

async function runWebExplorer(event) {
  event.preventDefault();
  const url = webPageUrlInput.value.trim();
  const depth = Number(exploreDepthSelect.value);

  if (!url) {
    showWebExplorerError("Enter a webpage URL before exploring.");
    webPageUrlInput.focus();
    return;
  }

  setWebExplorerLoading(true, depth);
  showWebExplorerLoading(url, depth);

  try {
    if (depth === 0) {
      const response = await fetch("/api/scrape", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      });
      const result = await readJson(response);

      if (!response.ok) {
        throw new Error(result.error || "This webpage could not be retrieved.");
      }

      showWebExplorerResult(result);
    } else {
      await runSiteCrawl(url, depth);
    }
  } catch (error) {
    showWebExplorerError(
      `${error.message || "This website could not be explored."} Please check the URL and try again.`,
    );
  } finally {
    setWebExplorerLoading(false, depth);
  }
}

async function runSiteCrawl(url, depth) {
  const startResponse = await fetch("/api/crawl", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, depth }),
  });
  const started = await readJson(startResponse);
  if (!startResponse.ok || !started.id) {
    throw new Error(started.error || "The crawl could not be started.");
  }

  setWebExplorerStatus("Exploring site… 0 pages retrieved.");

  for (let attempt = 0; attempt < MAX_CRAWL_POLLS; attempt += 1) {
    if (attempt > 0) await delay(CRAWL_POLL_DELAY_MS);

    const statusResponse = await fetch(
      `/api/crawl/status?id=${encodeURIComponent(started.id)}`,
      { headers: { Accept: "application/json" } },
    );
    const result = await readJson(statusResponse);
    if (!statusResponse.ok) {
      throw new Error(result.error || "Crawl progress could not be checked.");
    }
    if (result.status === "failed") {
      throw new Error(result.error || "This site could not be cleanly crawled.");
    }

    showCrawlProgress(result);
    if (result.status === "completed") {
      showCrawlResult({ ...result, startingUrl: started.url || url, depth });
      return;
    }
  }

  throw new Error("This crawl is taking longer than expected. Please try a smaller site.");
}

function showWebExplorerLoading(url, depth) {
  webExplorerResult.hidden = false;
  webExplorerResult.replaceChildren();

  const title = document.createElement("h3");
  title.id = "web-explorer-result-title";
  title.textContent = depth === 0 ? "Reading page…" : "Starting crawl…";

  const source = document.createElement("p");
  source.className = "panel-source";
  source.textContent = url;

  webExplorerResult.append(title, source);
  setWebExplorerStatus(
    depth === 0 ? "Reading page…" : `Starting a depth ${depth} crawl with a 25-page limit…`,
  );
}

function showWebExplorerResult(result) {
  webExplorerResult.hidden = false;
  webExplorerResult.replaceChildren();

  const title = document.createElement("h3");
  title.id = "web-explorer-result-title";
  title.textContent = result.title || result.domain || "Retrieved webpage";

  const domain = document.createElement("p");
  domain.className = "panel-source";
  domain.textContent = result.domain || "Web page";

  const url = document.createElement("a");
  url.className = "result-url";
  url.href = result.url;
  url.target = "_blank";
  url.rel = "noopener noreferrer";
  url.textContent = result.url;

  const description = document.createElement("p");
  description.className = "result-description";
  description.textContent = result.description || "No metadata description was available.";

  const content = document.createElement("pre");
  content.className = "panel-content";
  content.textContent = result.content || "No readable page content was returned.";

  const originalLink = document.createElement("a");
  originalLink.className = "panel-link";
  originalLink.href = result.url;
  originalLink.target = "_blank";
  originalLink.rel = "noopener noreferrer";
  originalLink.textContent = "Open Original Page ↗";

  webExplorerResult.append(title, domain, url, description, content, originalLink);
  setWebExplorerStatus("Webpage retrieved successfully.");
  webExplorerResult.focus({ preventScroll: true });
}

function showCrawlProgress(result) {
  const count = Number(result.pagesRetrieved) || 0;
  setWebExplorerStatus(`Exploring site… ${count} ${count === 1 ? "page" : "pages"} retrieved.`);
}

function showCrawlResult(result) {
  webExplorerResult.hidden = false;
  webExplorerResult.replaceChildren();

  const title = document.createElement("h3");
  title.id = "web-explorer-result-title";
  title.textContent = "Site Exploration Result";

  const summary = document.createElement("dl");
  summary.className = "crawl-summary";
  appendCrawlSummary(summary, "Starting URL", result.startingUrl);
  appendCrawlSummary(summary, "Selected depth", String(result.depth));
  appendCrawlSummary(summary, "Pages retrieved", String(result.pagesRetrieved || 0));
  appendCrawlSummary(summary, "Page cap", result.capReached ? "Reached (25 pages)" : "Not reached");

  const pages = document.createElement("div");
  pages.className = "crawl-page-list";
  const crawlPages = Array.isArray(result.pages) ? result.pages.slice(0, 25) : [];

  if (crawlPages.length === 0) {
    const empty = document.createElement("p");
    empty.className = "crawl-empty";
    empty.textContent = "The crawl completed without readable page excerpts.";
    pages.append(empty);
  } else {
    crawlPages.forEach((page) => pages.append(createCrawlPageCard(page)));
  }

  webExplorerResult.append(title, summary, pages);
  setWebExplorerStatus(
    result.capReached
      ? "Stopped at the 25-page classroom limit."
      : `Completed: ${result.pagesRetrieved || 0} ${result.pagesRetrieved === 1 ? "page" : "pages"}.`,
  );
  webExplorerResult.focus({ preventScroll: true });
}

function appendCrawlSummary(list, label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = value;
  wrapper.append(term, detail);
  list.append(wrapper);
}

function createCrawlPageCard(page) {
  const card = document.createElement("article");
  card.className = "crawl-page-card";

  const title = document.createElement("h4");
  title.textContent = page.title || "Untitled page";

  const url = document.createElement("p");
  url.className = "crawl-page-url";
  url.textContent = page.url;

  const excerpt = document.createElement("p");
  excerpt.className = "crawl-excerpt";
  excerpt.textContent = page.excerpt || "No readable excerpt was returned for this page.";

  const link = document.createElement("a");
  link.className = "crawl-page-link";
  link.href = page.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Open Page ↗";

  card.append(title, url, excerpt, link);
  return card;
}

function showWebExplorerError(message) {
  webExplorerResult.hidden = false;
  webExplorerResult.replaceChildren();

  const title = document.createElement("h3");
  title.id = "web-explorer-result-title";
  title.textContent = "Website could not be explored";

  const errorMessage = document.createElement("p");
  errorMessage.className = "panel-source";
  errorMessage.textContent = message;

  webExplorerResult.append(title, errorMessage);
  setWebExplorerStatus(message, true);
  webExplorerResult.focus({ preventScroll: true });
}

async function runJobScout(event) {
  event.preventDefault();
  const validation = validateJobSourceInputs();

  if (!validation.ok) {
    showJobScoutError(validation.error);
    validation.input?.focus();
    return;
  }

  setJobScoutLoading(true);
  jobResults.hidden = true;
  setJobScoutStatus(
    `Scanning ${validation.urls.length} public ${validation.urls.length === 1 ? "page" : "pages"}…`,
  );
  jobSourceInputs.forEach((input, index) => {
    setJobSourceStatus(index, input.value.trim() ? "Scanning" : "Waiting", input.value.trim() ? "scanning" : "");
  });

  try {
    const response = await fetch("/api/jobs/scan", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ urls: validation.urls }),
    });
    const result = await readJson(response);

    if (Array.isArray(result.sources)) updateJobSourceStatuses(result.sources);
    if (!response.ok) {
      throw new Error(result.error || "These job pages could not be scanned.");
    }

    const rankedJobs = Array.isArray(result.jobs)
      ? result.jobs.filter((job) => Array.isArray(job.reasons) && job.reasons.length === 3)
      : [];
    renderJobResults(rankedJobs);
    setJobScoutStatus(result.message || `Found ${rankedJobs.length} promising roles.`);
  } catch (error) {
    markScanningSourcesFailed();
    showJobScoutError(
      `${error.message || "These job pages could not be scanned."} The source fields remain editable.`,
    );
  } finally {
    setJobScoutLoading(false);
  }
}

function validateJobSourceInputs() {
  if (!jobSourceInputs[0].value.trim()) {
    return {
      ok: false,
      error: "Job Source 1 URL is required.",
      input: jobSourceInputs[0],
    };
  }

  const urls = [];
  for (const [index, input] of jobSourceInputs.entries()) {
    const value = input.value.trim();
    if (!value) continue;

    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("unsupported protocol");
      urls.push(parsed.toString());
    } catch {
      return {
        ok: false,
        error: `Job Source ${index + 1} URL must be a valid http:// or https:// URL.`,
        input,
      };
    }
  }

  return { ok: true, urls };
}

function updateJobSourceStatuses(sources) {
  jobSourceInputs.forEach((input, index) => {
    const value = input.value.trim();
    if (!value) {
      setJobSourceStatus(index, "Waiting");
      return;
    }

    let normalized = value;
    try {
      normalized = new URL(value).toString();
    } catch {
      // Frontend validation has already handled malformed values.
    }
    const source = sources.find((item) => item.url === normalized);
    if (!source) {
      setJobSourceStatus(index, "Could not extract", "failed");
      return;
    }

    const states = {
      extracted: ["Extracted", "extracted"],
      no_jobs: ["No jobs found", "no-jobs"],
      failed: ["Could not extract", "failed"],
    };
    const [label, state] = states[source.status] || ["Could not extract", "failed"];
    setJobSourceStatus(index, label, state, source.message);
  });
}

function renderJobResults(jobs) {
  jobResults.hidden = false;
  jobResultList.replaceChildren();

  if (jobs.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "job-results-empty";
    emptyState.textContent = "No qualifying junior opportunities were found across these pages.";
    jobResultList.append(emptyState);
    jobResults.focus({ preventScroll: true });
    return;
  }

  const fragment = document.createDocumentFragment();
  jobs.slice(0, 5).forEach((job, index) => fragment.append(createJobCard(job, index)));
  jobResultList.append(fragment);
  jobResults.focus({ preventScroll: true });
}

function createJobCard(job, index) {
  const card = document.createElement("article");
  card.className = "job-card";

  const rank = document.createElement("p");
  rank.className = "job-rank";
  rank.textContent = `#${job.rank || index + 1}`;

  const title = document.createElement("h4");
  title.textContent = job.title || "Untitled opportunity";

  const employer = document.createElement("p");
  employer.className = "job-employer";
  employer.textContent = job.employer || "Employer not listed";

  const metadata = document.createElement("dl");
  metadata.className = "job-metadata";
  appendJobMetadata(metadata, "Location", job.location);
  appendJobMetadata(metadata, "Source", job.sourceDomain);
  appendJobMetadata(metadata, "Type", job.employmentType);
  appendJobMetadata(metadata, "Published", job.postedDate);

  const reasons = document.createElement("ul");
  reasons.className = "job-reasons";
  job.reasons.slice(0, 3).forEach((reason) => {
    const item = document.createElement("li");
    const heading = document.createElement("strong");
    heading.textContent = `${reason.heading}: `;
    item.append(heading, document.createTextNode(reason.text));
    reasons.append(item);
  });

  card.append(rank, title, employer, metadata, reasons);

  if (job.jobUrl) {
    const link = document.createElement("a");
    link.className = "job-link";
    link.href = job.jobUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open Job Posting ↗";
    card.append(link);
  }

  return card;
}

function appendJobMetadata(list, label, value) {
  if (!value) return;
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = value;
  wrapper.append(term, detail);
  list.append(wrapper);
}

function showJobScoutError(message) {
  jobResults.hidden = false;
  jobResultList.replaceChildren();

  const errorMessage = document.createElement("p");
  errorMessage.className = "job-results-empty is-error";
  errorMessage.textContent = message;
  jobResultList.append(errorMessage);
  setJobScoutStatus(message, true);
  jobResults.focus({ preventScroll: true });
}

function clearJobResults() {
  jobResults.hidden = true;
  jobResultList.replaceChildren();
  jobSourceStatuses.forEach((_, index) => setJobSourceStatus(index, "Waiting"));
  setJobScoutStatus("Add at least one public job-listing page to begin.");
}

function markScanningSourcesFailed() {
  jobSourceStatuses.forEach((status, index) => {
    if (status.dataset.state === "scanning") {
      setJobSourceStatus(index, "Could not extract", "failed");
    }
  });
}

function setJobScoutLoading(isLoading) {
  scanJobsButton.disabled = isLoading;
  clearJobResultsButton.disabled = isLoading;
  jobSourceInputs.forEach((input) => {
    input.disabled = isLoading;
  });
  scanJobsButton.querySelector("span").textContent = isLoading
    ? "Scanning Job Pages…"
    : "Find Junior Opportunities";
}

function setJobSourceStatus(index, label, state = "", detail = "") {
  const status = jobSourceStatuses[index];
  status.textContent = label;
  status.dataset.state = state;
  status.title = detail;
}

function setJobScoutStatus(message, isError = false) {
  jobScoutStatus.textContent = message;
  jobScoutStatus.classList.toggle("is-error", isError);
}

function setLoadState(isLoading) {
  loadButton.disabled = isLoading;
  loadButton.querySelector("span").textContent = isLoading
    ? "Loading News…"
    : "Load Latest News";
}

function setDeepReadButtonsDisabled(isDisabled) {
  document.querySelectorAll(".deep-read-button").forEach((button) => {
    button.disabled = isDisabled;
  });
}

function setWebExplorerLoading(isLoading, depth) {
  scrapePageButton.disabled = isLoading;
  webPageUrlInput.disabled = isLoading;
  exploreDepthSelect.disabled = isLoading;
  scrapePageButton.querySelector("span").textContent = isLoading
    ? depth === 0
      ? "Reading Page…"
      : "Exploring Site…"
    : "Explore Site";
}

function setWebExplorerStatus(message, isError = false) {
  webExplorerStatus.textContent = message;
  webExplorerStatus.classList.toggle("is-error", isError);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("is-error", isError);
}

function renderEmptyState(message) {
  articleList.replaceChildren();
  const emptyState = document.createElement("p");
  emptyState.className = "empty-state";
  emptyState.textContent = message;
  articleList.append(emptyState);
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : dateFormatter.format(date);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
