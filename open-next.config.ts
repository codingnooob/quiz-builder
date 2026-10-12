import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Platform-owned (plan 06 §4.2): SSR only — no incremental cache, no tag cache, no queue (A7.1).
export default defineCloudflareConfig({});
