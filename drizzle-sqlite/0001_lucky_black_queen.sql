CREATE TABLE `notion_embedding` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`article_id` text NOT NULL,
	`chunk_idx` integer NOT NULL,
	`content` text NOT NULL,
	`embedding` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `notion`(`id`) ON UPDATE no action ON DELETE no action
);
