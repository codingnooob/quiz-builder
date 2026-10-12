import { headers } from 'next/headers';

import { isPreviewSurface } from '@/lib/request-origin';
import { verifyScreenshotToken } from '@/lib/screenshot-token';
import { scriptNonce } from '@/lib/script-nonce';

// Plan 06 §10 (A7.8, A10.6): the development link's banner — on the preview only, shown only when the page is opened
// directly (not inside the platform's or a builder's iframe), absent from Totalum's screenshots. `data-totalum-dev-banner`
// is what the screenshot job also hides. No client bundle: one inline line unhides it. Platform-owned.
export async function DevBanner() {
  if (!isPreviewSurface()) return null;
  if (await verifyScreenshotToken((await headers()).get('x-totalum-screenshot'))) return null;
  return (
    <>
      <div
        data-totalum-dev-banner=""
        suppressHydrationWarning
        hidden
        className="fixed inset-x-0 bottom-0 z-[2147483647] bg-orange-500 px-4 py-2 text-center text-sm text-white"
      >
        This is just a temporal link used for development, to get a permanent link publish your project.
      </div>
      <script
        nonce={await scriptNonce()}
        dangerouslySetInnerHTML={{
          __html: 'if(self===top)document.currentScript.previousElementSibling.hidden=false',
        }}
      />
    </>
  );
}
