# Firecrawl-Crawl4AI Adapter

A small adapter that lets LibreChat (and maybe other apps) use Crawl4AI through LibreChat's Firecrawl scraper setting.

## What It Does

LibreChat expects a Firecrawl-style scrape API.
Crawl4AI uses a different API.
This adapter sits in the middle and translates the requests.

## Requirements

- LibreChat
- Crawl4AI
- Docker

## Install

1. Put the `firecrawl-crawl4ai-adapter` folder next to your `docker-compose.yml`.
2. Add the adapter service to your Compose file.
3. Point LibreChat's Firecrawl settings to the adapter.
4. Build and restart the services.

## Example Docker Compose

```yaml
services:
  firecrawl-crawl4ai-adapter:
    build:
      context: ./firecrawl-crawl4ai-adapter
    container_name: firecrawl-crawl4ai-adapter
    environment:
      PORT: 3002
      CRAWL4AI_BASE_URL: http://crawl4ai:11235
      FIRECRAWL_API_KEY: change-me
    depends_on:
      - crawl4ai
    restart: unless-stopped
    network:
```

## LibreChat Settings

Set these environment variables for LibreChat:

```env
FIRECRAWL_API_URL=http://firecrawl-crawl4ai-adapter:3002
FIRECRAWL_API_KEY=change-me
FIRECRAWL_VERSION=v1
```

In `librechat.yaml`, use Firecrawl as the scraper:

```yaml
webSearch:
  scraperProvider: "firecrawl"
  firecrawlApiKey: "${FIRECRAWL_API_KEY}"
  firecrawlApiUrl: "${FIRECRAWL_API_URL}"
```

## What You Can Change

- `FIRECRAWL_API_KEY`: can be any shared value, as long as LibreChat and the adapter use the same one.
- `CRAWL4AI_BASE_URL`: change this if your Crawl4AI service has a different name or port.
- `PORT`: change this if you want the adapter to listen on a different internal port.
- `context: ./firecrawl-crawl4ai-adapter`: change this if the adapter folder is in a different location.
- `networks`: if your stack uses custom Docker networks, make sure LibreChat, Crawl4AI, and the adapter are on the same network.

## Clone Or Update

Clone the repo:

```bash
git clone https://github.com/YOURNAME/YOURREPO.git
```

Pull the latest changes later:

```bash
cd YOURREPO
git pull
```

If you are using this repo only for the adapter, place it next to the folder that contains your existing `docker-compose.yml`, then point the Compose `context` to the adapter folder.

Example:

```yaml
build:
  context: ./YOURREPO/firecrawl-crawl4ai-adapter
```

## Start

```bash
docker compose build firecrawl-crawl4ai-adapter
docker compose up -d firecrawl-crawl4ai-adapter librechat
```

## Notes

- This is for LibreChat web search scraping.
- It replaces `crawl4ai-proxy` for this use case.
- Crawl4AI still does the actual scraping.
