import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 3002);
const CRAWL4AI_BASE_URL = stripTrailingSlash(
  process.env.CRAWL4AI_BASE_URL || 'http://crawl4ai:11235',
);
const API_KEY = process.env.FIRECRAWL_API_KEY || process.env.API_KEY || '';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 120000);

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function json(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function noContent(response, statusCode = 204) {
  response.writeHead(statusCode);
  response.end();
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let data = '';
    request.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    request.on('error', reject);
  });
}

function parseBearerToken(headerValue) {
  if (!headerValue) {
    return '';
  }
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match ? match[1] : '';
}

function isAuthorized(request) {
  if (!API_KEY) {
    return true;
  }
  const bearer = parseBearerToken(request.headers.authorization);
  const headerKey = request.headers['x-api-key'];
  return bearer === API_KEY || headerKey === API_KEY;
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return '';
}

function pickFirstObject(...values) {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value;
    }
  }
  return {};
}

function textFromMarkdownField(markdownField) {
  if (typeof markdownField === 'string') {
    return markdownField;
  }
  if (markdownField && typeof markdownField === 'object') {
    return pickFirstString(
      markdownField.fit_markdown,
      markdownField.raw_markdown,
      markdownField.markdown,
      markdownField.text,
      markdownField.content,
    );
  }
  return '';
}

function extractMarkdown(result) {
  return pickFirstString(
    result.markdown,
    result.fit_markdown,
    result.raw_markdown,
    textFromMarkdownField(result.markdown_v2),
    textFromMarkdownField(result.markdown_result),
    textFromMarkdownField(result.markdown_data),
    result.text,
    result.content,
  );
}

function extractHtml(result) {
  return pickFirstString(result.cleaned_html, result.html, result.raw_html);
}

function extractMetadata(result, fallbackUrl) {
  const metadata = pickFirstObject(result.metadata, result.meta);
  const links = pickFirstObject(result.links);
  return {
    title: pickFirstString(metadata.title, result.title),
    description: pickFirstString(metadata.description, metadata.ogDescription),
    language: pickFirstString(metadata.language, metadata.lang),
    sourceURL: pickFirstString(metadata.sourceURL, metadata.url, result.url, fallbackUrl),
    url: pickFirstString(metadata.url, result.url, fallbackUrl),
    statusCode:
      Number.isFinite(result.status_code) ? result.status_code :
      Number.isFinite(result.statusCode) ? result.statusCode :
      Number.isFinite(metadata.statusCode) ? metadata.statusCode :
      200,
    error: pickFirstString(result.error_message, result.error, metadata.error),
    links,
  };
}

function normalizeFirecrawlSuccess(result, requestedUrl, taskId = '') {
  const markdown = extractMarkdown(result);
  const html = extractHtml(result);
  const metadata = extractMetadata(result, requestedUrl);

  return {
    success: true,
    data: {
      markdown,
      html,
      metadata,
    },
    scrapeId: taskId || pickFirstString(result.task_id, result.taskId, result.id),
    warning: metadata.error || undefined,
  };
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }

    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: options.headers || {},
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

function buildCrawl4aiPayload(body) {
  const waitFor = Number(body.waitFor || 0);
  const timeout = Number(body.timeout || 0);
  const headers = pickFirstObject(body.headers);
  const bodyFormats = Array.isArray(body.formats) ? body.formats : [];

  const crawlerConfig = {
    stream: false,
    cache_mode: 'BYPASS',
  };

  if (Number.isFinite(timeout) && timeout > 0) {
    crawlerConfig.page_timeout = timeout;
  }

  if (Number.isFinite(waitFor) && waitFor > 0) {
    crawlerConfig.wait_for = `js:() => new Promise(resolve => setTimeout(resolve, ${waitFor}))`;
    crawlerConfig.delay_before_return_html = waitFor / 1000;
  }

  if (body.onlyMainContent === true) {
    crawlerConfig.only_text = false;
    crawlerConfig.excluded_tags = ['nav', 'footer', 'aside', 'form'];
    crawlerConfig.remove_overlay_elements = true;
  }

  if (body.blockAds === true) {
    crawlerConfig.remove_overlay_elements = true;
  }

  if (body.removeBase64Images === true) {
    crawlerConfig.exclude_external_images = true;
  }

  if (body.excludeTags && Array.isArray(body.excludeTags) && body.excludeTags.length > 0) {
    crawlerConfig.excluded_tags = body.excludeTags;
  }

  if (body.includeTags && Array.isArray(body.includeTags) && body.includeTags.length > 0) {
    crawlerConfig.included_tags = body.includeTags;
  }

  const browserConfig = {
    headless: true,
    text_mode: false,
    light_mode: true,
  };

  if (Object.keys(headers).length > 0) {
    browserConfig.headers = headers;
  }

  if (body.mobile === true) {
    browserConfig.viewport_width = 430;
    browserConfig.viewport_height = 932;
  }

  if (body.ignoreHttpsErrors === true) {
    browserConfig.ignore_https_errors = true;
  }

  return {
    urls: [body.url],
    browser_config: browserConfig,
    crawler_config: crawlerConfig,
    requested_formats: bodyFormats,
  };
}

async function scrapeViaCrawlEndpoint(body) {
  const payload = buildCrawl4aiPayload(body);
  const { response, payload: data } = await fetchJson(`${CRAWL4AI_BASE_URL}/crawl`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = pickFirstString(data?.detail, data?.message, data?.error, data?.raw);
    throw new HttpError(response.status, message || `Crawl4AI /crawl failed with ${response.status}`);
  }

  const result = Array.isArray(data?.results) ? data.results[0] :
    Array.isArray(data?.data) ? data.data[0] :
    data?.result || data;

  if (!result || typeof result !== 'object') {
    throw new HttpError(502, 'Crawl4AI returned an unexpected /crawl payload');
  }

  return normalizeFirecrawlSuccess(result, body.url, pickFirstString(data?.task_id, data?.taskId));
}

async function scrapeViaMarkdownEndpoint(body) {
  const encodedUrl = encodeURIComponent(body.url);
  const { response, text } = await fetchText(`${CRAWL4AI_BASE_URL}/md/${encodedUrl}`);

  if (!response.ok) {
    throw new HttpError(response.status, `Crawl4AI /md failed with ${response.status}`);
  }

  let markdown = text;
  try {
    const parsed = JSON.parse(text);
    markdown = pickFirstString(
      parsed.markdown,
      parsed.fit_markdown,
      parsed.raw_markdown,
      parsed.text,
      parsed.content,
      parsed.data?.markdown,
      parsed.data?.fit_markdown,
      parsed.data?.raw_markdown,
      parsed.raw,
    ) || text;
  } catch {
    // Plain text markdown is fine.
  }

  return {
    success: true,
    data: {
      markdown,
      html: '',
      metadata: {
        title: '',
        description: '',
        language: '',
        sourceURL: body.url,
        url: body.url,
        statusCode: 200,
        error: '',
        links: {},
      },
    },
  };
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function handleScrape(request, response) {
  if (!isAuthorized(request)) {
    json(response, 401, {
      success: false,
      error: 'Unauthorized',
    });
    return;
  }

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    json(response, 400, {
      success: false,
      error: error.message,
    });
    return;
  }

  if (!body.url || typeof body.url !== 'string') {
    json(response, 400, {
      success: false,
      error: 'Missing required field: url',
    });
    return;
  }

  try {
    const result = await scrapeViaCrawlEndpoint(body);
    json(response, 200, result);
  } catch (primaryError) {
    try {
      const fallback = await scrapeViaMarkdownEndpoint(body);
      fallback.warning = pickFirstString(primaryError.message);
      json(response, 200, fallback);
    } catch (fallbackError) {
      const statusCode = fallbackError.statusCode || primaryError.statusCode || 502;
      json(response, statusCode, {
        success: false,
        error: pickFirstString(fallbackError.message, primaryError.message, 'Scrape failed'),
      });
    }
  }
}

async function handleHealth(response) {
  try {
    const { response: upstream } = await fetchText(`${CRAWL4AI_BASE_URL}/health`);
    json(response, upstream.ok ? 200 : 503, {
      ok: upstream.ok,
      adapter: 'firecrawl-crawl4ai-adapter',
      crawl4ai: upstream.ok ? 'reachable' : 'unhealthy',
    });
  } catch (error) {
    json(response, 503, {
      ok: false,
      adapter: 'firecrawl-crawl4ai-adapter',
      crawl4ai: 'unreachable',
      error: error.message,
    });
  }
}

const server = http.createServer(async (request, response) => {
  const method = request.method || 'GET';
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    await handleHealth(response);
    return;
  }

  if (method === 'GET' && url.pathname === '/v1') {
    json(response, 200, {
      ok: true,
      name: 'firecrawl-crawl4ai-adapter',
      version: '0.1.0',
      crawl4aiBaseUrl: CRAWL4AI_BASE_URL,
    });
    return;
  }

  if (method === 'POST' && (url.pathname === '/v1/scrape' || url.pathname === '/scrape')) {
    await handleScrape(request, response);
    return;
  }

  if (method === 'OPTIONS') {
    noContent(response);
    return;
  }

  json(response, 404, {
    success: false,
    error: `No route for ${method} ${url.pathname}`,
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`firecrawl-crawl4ai-adapter listening on :${PORT}`);
  console.log(`proxying scrape requests to ${CRAWL4AI_BASE_URL}`);
});