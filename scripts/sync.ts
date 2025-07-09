import {getNotionClient, timeoutMs, Row} from '../lib/notion/client';
import {LogLevel} from '@notionhq/client';
import {PrismaClient} from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
  const notion = getNotionClient({
    auth: process.env.NOTION_TOKEN!,
    dbId: process.env.NOTION_DB_ID!,
    logLevel: LogLevel.WARN,
    timeoutMs: timeoutMs.CI,
  });

  const rows: Row[] = await notion.getUpdatedRows();

  const upserts = rows.map(r => {
    return prisma.article.upsert({
      where: {id: r.id},
      update: {
        title: r.title,
        description: r.description,
        tags: JSON.stringify(r.tags),
        createdAt: r.createdAt,
        markdown: r.markdown,
        status: r.status,
        lastEdited: r.lastEdited,
      },
      create: {
        id: r.id,
        title: r.title,
        description: r.description,
        tags: JSON.stringify(r.tags),
        createdAt: r.createdAt,
        markdown: r.markdown,
        status: r.status,
        lastEdited: r.lastEdited,
      },
    });
  });

  await prisma.$transaction(upserts);
  console.log(`Upserted ${upserts.length} articles.`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
