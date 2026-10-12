CREATE TABLE `quiz_pdfs` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`language` text NOT NULL,
	`kind` text NOT NULL,
	`url` text NOT NULL,
	`file_key` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_pdfs_unique` ON `quiz_pdfs` (`quiz_id`,`language`,`kind`);--> statement-breakpoint
CREATE TABLE `quiz_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`section_id` text NOT NULL,
	`position` integer NOT NULL,
	`difficulty` text NOT NULL,
	`correct_index` integer NOT NULL,
	`content` text NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `quiz_sections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quiz_questions_quiz_id` ON `quiz_questions` (`quiz_id`);--> statement-breakpoint
CREATE INDEX `quiz_questions_section_id` ON `quiz_questions` (`section_id`);--> statement-breakpoint
CREATE TABLE `quiz_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`included` integer DEFAULT true NOT NULL,
	`target_questions` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quiz_sections_quiz_id` ON `quiz_sections` (`quiz_id`);--> statement-breakpoint
CREATE TABLE `quizzes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`file_name` text NOT NULL,
	`file_key` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`count_mode` text DEFAULT 'per_section' NOT NULL,
	`question_count` integer DEFAULT 5 NOT NULL,
	`difficulty` text DEFAULT 'mixed' NOT NULL,
	`languages` text DEFAULT '["English"]' NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
