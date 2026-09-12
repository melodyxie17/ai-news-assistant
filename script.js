const loadButton = document.querySelector("#load-news");
const filterInput = document.querySelector("#news-filter");
const statusElement = document.querySelector("#news-status");
const articleList = document.querySelector("#article-list");
const deepReadPanel = document.querySelector("#deep-read-panel");
const deepReadContent = document.querySelector("#deep-read-content");

let loadedArticles = [];

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

loadButton.addEventListener("click", loadNews);
filterInput.addEventListener("input", renderFilteredArticles);

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
