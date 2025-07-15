# knowledge-base

Notion CMS sync w/ GitHub as snapshot storage

- Design Diagram coming soon...

# Notable Features
- All content in this repo is managed in a Notion database
- Edits are synced via a GitHub action that does a number of things
    - dumps the entire notion database into a fresh postgres db
    - creates/updates embeddings for every article
    - connects to the backend db running on [koyeb](https://www.koyeb.com/) and updates the hosted postgres db
    - dumps the postgres db into a sql db to be committed into this repo as well as the [frontend repo](https://github.com/adit-bala?tab=repositories)


