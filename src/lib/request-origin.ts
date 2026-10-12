// Plan 06 §7.1: the public origin of a request. X-Forwarded-* only when TOTALUM_TRUST_PROXY=1 (the Sprite bridge
// behind the dispatcher); inside the Worker the request URL (its Host) is authoritative.
export function requestOrigin(req: Request): string {
  const forwardedHost = process.env.TOTALUM_TRUST_PROXY === '1' && req.headers.get('x-forwarded-host');
  if (!forwardedHost) return new URL(req.url).origin;
  return `${req.headers.get('x-forwarded-proto') ?? 'https'}://${forwardedHost}`;
}

// A4.14: the preview Worker and the Sprite bridge are embedded cross-site by the platform; PGM and AM set
// TOTALUM_USAGE_ENV=dev on exactly those surfaces.
export const isPreviewSurface = (): boolean => process.env.TOTALUM_USAGE_ENV === 'dev';
