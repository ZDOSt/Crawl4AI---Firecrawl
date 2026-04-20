# Firecrawl -> Crawl4AI adapter for LibreChat

This adapter lets LibreChat keep using `scraperProvider: "firecrawl"` while routing scrape requests to a local Crawl4AI container.

## What it supports

- `POST /v1/scrape`
- `POST /scrape`
- `GET /health`
- `GET /v1`

It implements the minimum Firecrawl-style scrape surface LibreChat needs for web search.

## How it works

1. LibreChat sends a Firecrawl-style scrape request to this adapter.
2. The adapter translates the request into a Crawl4AI `/crawl` request.
3. If `/crawl` fails because your Crawl4AI version has a different shape, the adapter falls back to Crawl4AI's markdown endpoint.
4. The adapter returns a Firecrawl-style response with `data.markdown` so LibreChat can continue normally.

## Files

- `server.js` - the adapter service
- `Dockerfile` - container image for compose
- `package.json` - minimal Node metadata

## Docker Compose

Add this service next to `crawl4ai` and point LibreChat at it instead of `crawl4ai-proxy`.

```yaml
  firecrawl-crawl4ai-adapter:
    build:
      context: ./firecrawl-crawl4ai-adapter
    container_name: firecrawl-crawl4ai-adapter
    environment:
      - PORT=3002
      - CRAWL4AI_BASE_URL=http://crawl4ai:11235
      - FIRECRAWL_API_KEY=dummy-local
    depends_on:
      - crawl4ai
    restart: unless-stopped
    networks:
      - app-network
```

You can remove `crawl4ai-proxy` from your stack for this LibreChat use case.

## LibreChat env

```env
FIRECRAWL_API_URL=http://firecrawl-crawl4ai-adapter:3002
FIRECRAWL_API_KEY=dummy-local
FIRECRAWL_VERSION=v1
```

## librechat.yaml

Keep your current scraper setup, just make sure it points at the adapter URL above.

```yaml
webSearch:
  searchProvider: "searxng"
  searxngInstanceUrl: "${SEARXNG_INSTANCE_URL}"
  searxngApiKey: "${SEARXNG_API_KEY}"

  scraperProvider: "firecrawl"
  firecrawlApiKey: "${FIRECRAWL_API_KEY}"
  firecrawlApiUrl: "${FIRECRAWL_API_URL}"

  firecrawlOptions:
    formats: ["markdown"]
    onlyMainContent: true
    blockAds: true
    removeBase64Images: true
    timeout: 60000
    waitFor: 2000

  rerankerType: "jina"
  jinaApiKey: "${JINA_API_KEY}"
  jinaApiUrl: "${JINA_API_URL}"

  scraperTimeout: 90000
  safeSearch: 1
```

## Start it

From the directory that contains your compose file:

```bash
docker compose up -d --build firecrawl-crawl4ai-adapter
```

Then restart LibreChat:

```bash
docker compose up -d librechat
```

## Quick checks

Health:

```bash
curl http://localhost:3002/health
```

Manual scrape test:

```bash
curl -X POST http://localhost:3002/v1/scrape \
  -H "Authorization: Bearer dummy-local" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown"],
    "onlyMainContent": true,
    "timeout": 60000,
    "waitFor": 1000
  }'
```

A successful response should include:

```json
{
  "success": true,
  "data": {
    "markdown": "..."
  }
}
```

## Notes

- This is intentionally minimal. It is built for LibreChat web search scrape calls, not the full Firecrawl API surface.
- If Crawl4AI changes response fields between image versions, the adapter tries multiple markdown field names before failing.
- If you want, the next step can be adding `POST /v1/batch/scrape` or tighter mapping for more Firecrawl options.