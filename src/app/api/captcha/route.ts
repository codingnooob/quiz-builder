import { issueChallenge } from '@/lib/captcha';

// The challenge the sign-up and sign-in forms send back (src/lib/captcha.ts). Platform-owned; never edit.
export const GET = issueChallenge;
