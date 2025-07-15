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


