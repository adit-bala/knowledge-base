-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "markdown" TEXT NOT NULL,
    "markdownHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastEdited" DATETIME NOT NULL
);
