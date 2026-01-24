# knowledge-base

Notion CMS sync with PGlite for portable PostgreSQL storage.

## Notable Features

- All content is managed in a Notion database
- Syncs via a GitHub Action that:
  - Extracts metadata and article content from Notion
  - Downloads and stores images as BLOBs in the database
  - Uses GPT-4o-mini to generate article descriptions and sample questions for semantic search
  - Creates vector embeddings using OpenAI's text-embedding-3-small model
  - Exports the database as a portable gzipped tarball (`db/notion.db.tar.gz`)
  - Commits the database to this repo and the [frontend repo](https://github.com/adit-bala/portfolio)

### Architecture

The sync pipeline uses **PGlite** (WASM-based PostgreSQL) instead of a traditional PostgreSQL server. This means:
- No Docker or external database required
- Database runs entirely in-process
- Supports pgvector for embeddings
- Portable tarball format for easy distribution

### Three-Phase Pipeline

1. **Fetch Phase** - Retrieve data from Notion, download images
2. **Update Phase** - Upsert articles, store images, generate embeddings
3. **Upload Phase** - Export database to tarball

Smart diffing skips unchanged articles based on `last_edited_time` timestamps.

## Setup

Clone this repo:
```bash
git clone git@github.com:adit-bala/knowledge-base.git
cd knowledge-base
npm install
```

Create a `.env` file:
```
NOTION_TOKEN=<notion api key>
NOTION_DB_ID=<id of notion database>
OPENAI_API_KEY=<openai api key>
```

For the backend (in `./backend/.env`):
```
OPENAI_API_KEY=<openai api key>
CO_API_KEY=<cohere api key>
```

## Running Locally

### Sync Notion to PGlite

No Docker required! Simply run:
```bash
npm run sync
```

This will:
1. Fetch all articles from Notion
2. Download images and store them as BLOBs
3. Generate LLM descriptions and embeddings for each article
4. Export to `db/notion.db.tar.gz`

### Query the Database

Interactive query tool with multiple modes:
```bash
npm run query
```

Commands:
- `/sql <query>` - Execute raw SQL
- `/articles` - List all articles
- `/stats` - Show database stats
- `/ask <question>` - Hybrid search (vector + full-text) returning top 5 articles
- `<text>` - RAG search with AI-generated answer
- `/quit` - Exit

Example:
```
> /ask What does Aditya do for fun?
> /sql SELECT title, tags FROM article LIMIT 5
> What has Aditya been working on?
```

### Backend Agent

To run the backend:
```bash
cd backend/
docker compose up --build
```

Test with:
```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "What does Aditya like to do?"}'
```

## Testing

Run all tests:
```bash
npm test
```

## GitHub Actions

The sync workflow runs daily at 9 AM PST and can be triggered manually. It:
1. Syncs Notion → PGlite
2. Commits `db/notion.db.tar.gz` to this repo
3. Pushes the database to the frontend repo



