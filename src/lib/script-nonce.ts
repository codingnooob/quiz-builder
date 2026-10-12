import { headers } from 'next/headers';

/**
 * The nonce of this response's script-src (B3-AT5; worker.ts mints it and hands it to Next on the request). An inline
 * script runs only with it: `<script nonce={await scriptNonce()} …>` or `<Script nonce={…}>` in a server component.
 * `undefined` under `npm run dev`, which sends no Content-Security-Policy. Platform-owned.
 */
export async function scriptNonce(): Promise<string | undefined> {
  return /'nonce-([^']+)'/.exec((await headers()).get('content-security-policy') ?? '')?.[1];
}
