CREATE TABLE `notion` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`markdown` text NOT NULL,
	`status` text NOT NULL,
	`last_edited` text NOT NULL
);
