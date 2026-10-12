CREATE INDEX `users_email_key` ON `users` (lower(replace(substr("email", 1, instr("email", '@') - 1), '.', '') || substr("email", instr("email", '@'))));
