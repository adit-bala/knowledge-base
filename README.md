# knowledge-base

Notion CMS sync with GitHub as snapshot storage

- Design Diagram coming soon...

# Notable Features
- All content in this repo is managed in a Notion database
- Edits are synced via a GitHub action that does a number of things
    - dumps the entire notion database into a fresh PostgreSQL database
    - creates/updates embeddings for every article
    - connects to the backend db running on [koyeb](https://www.koyeb.com/) and updates the hosted PostgreSQL db
    - dumps the PostgreSQL database into a SQL database to be committed into this repo as well as the [frontend repo](https://github.com/adit-bala/portfolio)
- [backend folder](https://github.com/adit-bala/knowledge-base/tree/main/backend) contains the code running on [koyeb](https://www.koyeb.com/) and updates the hosted postgres db
    - Routes requests to an agent with access to different tools to answer a user's natural language query
        - query_blog_db_natural: takes in a user query and uses RAG (pgvector + full-text search + cross-encoder reranking) to retrieve relevant chunks from my blog
        - list_blog_post_titles_and_description: lists all blog post titles and descriptions
        - query_blog_db_sql: raw SQL queries for perhaps more analytical questions from the user (How many blogs did Aditya write in each year?)

# How to use this repo

## Setup

First clone this repo
```
git clone git@github.com:adit-bala/knowledge-base.git
```

You will need the following in both `.env` files (one in `./.env` and one in `./backend/.env`
```
NOTION_TOKEN=<notion api key>
NOTION_DB_ID=<id of notion database>
DATABASE_URL=<local db URL, ex. postgresql://postgres:postgres@localhost:5432/notion>
PROD_DB_ADMIN_URL=<prod db url for the github action to connect to>
OPENAI_API_KEY=<openai api key>
FRONTEND_REPO_PAT=<github token with permissions to write into the frontend repo>
CO_API_KEY=<cohere api keys>
```

Then run npm install in the root dir and `/backend`

## Running locally

### Knowledge Base

To spin up a local PostgreSQL DB, I recommend Docker. This is the command I ran

```
docker run --name notion-postgres -e POSTGRES_DB=notion -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d pgvector/pgvector:pg16
```

Then, to initialize our schema, we can run 

```
npx drizzle-kit migrate
```

We can get our data into the DB now by running

```
npm run sync
```

We can also dump our PostgreSQL DB into SQLite by running

```
npm run export
```

### Backend Agent

To get the backend running, run the following commands

```
cd backend/
docker compose-up --build
```

Now, we have to ensure our agent has access to the same PostgreSQL DB we have running locally, so we can copy the data with

```
npm run copy-pg -- \
  --source=postgresql://postgres:postgres@localhost:5432/notion \
  --dest=postgresql://postgres:postgres@localhost:5433/notion
```

## Testing

### Knowledge Base

The knowledge base comes up with a query script to test the agent. You can run

```
npm run query
```

And then input a question.

### Backend Agent

We can now test our backend agent by sending a curl command in another terminal

```
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d "{\"question\": \"<insert question>?\"}"
```



