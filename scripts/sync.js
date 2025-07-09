"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../lib/notion/client");
const client_2 = require("@notionhq/client");
const client_3 = require("@prisma/client");
require("dotenv/config");
const prisma = new client_3.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const notion = (0, client_1.getNotionClient)({
            auth: process.env.NOTION_TOKEN,
            dbId: process.env.NOTION_DB_ID,
            logLevel: client_2.LogLevel.WARN,
            timeoutMs: client_1.timeoutMs.CI,
        });
        const rows = yield notion.getUpdatedRows();
        const upserts = rows.map(r => {
            return prisma.article.upsert({
                where: { id: r.id },
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
        yield prisma.$transaction(upserts);
        console.log(`Upserted ${upserts.length} articles.`);
    });
}
main()
    .catch(console.error)
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
}));
