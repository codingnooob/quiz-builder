# Payments — `totalum.payments` (Stripe Checkout)

Stripe on the project's own connected account: buyers pay on Stripe's hosted Checkout page (card data never touches
the app). Server-side only. Never install `stripe` and never ask for a Stripe key, unless the user asks to use their
own Stripe keys (last section).

<!-- totalum-sdk:signatures payments -payments.onboardingLink -->
| Call | Returns |
|---|---|
| `totalum.payments.getStatus()` | `{ enabled, mode: 'connect' \| 'own_key', accountId, livemode, chargesEnabled, payoutsEnabled, detailsSubmitted, requirements, liveEnabled, disconnectedAt? }` |
| `totalum.payments.createCheckout({ mode: 'payment' \| 'subscription' \| 'setup', successUrl, cancelUrl, lineItems?, currency?, customerEmail?, customerId?, metadata?, allowPromotionCodes?, automaticTax?, trialDays?, clientReferenceId? })` | `{ id, url }` |
| `totalum.payments.getCheckout(sessionId)` | `{ id, status: 'expired' \| 'open' \| 'complete', paymentStatus: 'paid' \| 'unpaid' \| 'no_payment_required', amountTotal, currency, metadata, paymentIntentId, customerEmail, clientReferenceId, customerId, subscriptionId }` |
| `totalum.payments.customerPortalLink({ customerId, returnUrl })` | `{ url }` |
| `totalum.payments.subscriptions.get(subscriptionId)` | `{ id, status, customerId, cancelAtPeriodEnd, currentPeriodEnd, canceledAt, metadata }` |
| `totalum.payments.subscriptions.update(subscriptionId, { cancelAtPeriodEnd })` | `{ id, status, customerId, cancelAtPeriodEnd, currentPeriodEnd, canceledAt, metadata }` |
| `totalum.payments.subscriptions.cancel(subscriptionId)` | `{ id, status, customerId, cancelAtPeriodEnd, currentPeriodEnd, canceledAt, metadata }` |
| `totalum.payments.refunds.create({ paymentIntentId, amount?, reason?: 'duplicate' \| 'fraudulent' \| 'requested_by_customer' })` | `{ id, status, amount, currency }` |
<!-- /totalum-sdk:signatures -->

- `createCheckout` → redirect the buyer to `url`; `lineItems: [{ name, unitAmount, currency, quantity }]` or
  `[{ priceId, quantity }]`. `getStatus().livemode` says whether this request charges real cards.
- `refunds.create({ paymentIntentId })` refunds all of it (or `amount`); the payment intent id is
  `data.object.payment_intent` of `payments.checkout.session.completed`. Store it on the order.

## Test mode and live mode

The same code runs in both; never branch on the mode, never ask for keys. The preview, the sandbox and scripts always
use Stripe **test mode**, and it works at once with no setup by anyone: pay with card `4242 4242 4242 4242`, any future
expiry, any CVC. Real cards are charged only on the published site, after the owner connects Stripe (**Payments →
Connect Stripe**, their real account) and switches the published site to real payments; until then it is test too.
After adding payments, say so in your final message: "the preview takes test cards now; to receive real money, connect
Stripe in the Payments settings, then switch your published site to real payments". Disputes and payouts are the
owner's, in their Stripe Dashboard (`payments.charge.dispute.created` reaches the payment events route).

`unitAmount` is in the currency's smallest unit (29 € → `2900`, `currency: 'eur'`). `successUrl`/`cancelUrl` are
absolute https URLs of this site: build them from the request origin (`new URL(req.url).origin`). A price the
owner created in Stripe can be `{ priceId, quantity }` instead. Monthly plans and memberships: see Subscriptions
below.

## Recipe — a "Buy" button, and the order marked paid

```ts
// src/app/api/checkout/route.ts
// public: a guest may buy; the price comes from the server, never from the browser
import { totalum } from 'totalum-sdk';

export async function POST(req: Request) {
  const site = new URL(req.url).origin; // https on the preview; `npm run dev`'s http://localhost is refused (VALIDATION_ERROR)
  const orderId = crypto.randomUUID(); // insert the order row (status 'pending', its items) with this id first
  try {
    const { url } = await totalum.payments.createCheckout({
      mode: 'payment',
      lineItems: [{ name: 'Pro plan', unitAmount: 2900, currency: 'eur', quantity: 1 }],
      successUrl: `${site}/api/checkout/return?order=${orderId}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${site}/cart`,
      metadata: { orderId },
    });
    return Response.json({ ok: true, data: { url } });
  } catch (err) {
    console.error('checkout failed', err);
    return Response.json({ ok: false, error: 'Payments are not available right now' }, { status: 502 });
  }
}
```

```ts
// src/app/api/checkout/return/route.ts — Stripe sends the buyer here after paying (the one GET that writes)
// public: the buyer may be a guest; the order is marked paid only when Stripe says so
export async function GET(req: Request) {
  const u = new URL(req.url);
  const orderId = u.searchParams.get('order') ?? '';
  try {
    const s = await totalum.payments.getCheckout(u.searchParams.get('session_id') ?? '');
    if (s.paymentStatus === 'paid' && s.metadata.orderId === orderId) await markPaid(orderId, s.paymentIntentId);
  } catch (err) {
    console.error('payment check failed', err);
  }
  return Response.redirect(new URL(`/orders/${orderId}`, req.url), 303);
}
```

The button (`'use client'`) opens Checkout in a **new tab** (it cannot load inside the builder's preview frame; the
same tab only if the owner asks): on click `const tab = window.open('', '_blank')`, POST to `/api/checkout`, then
`tab.location.href = data.url` (`tab.close()` on an error). The customer portal link opens the same way. `markPaid` works
once: `UPDATE orders SET status = 'paid', payment_intent_id = ? WHERE id = ? AND status = 'pending'`, and only when
`meta.changes === 1` it lowers the stock and e-mails the receipt, so a reload never does it twice. This needs no
webhook; `payments.checkout.session.completed` also reaches the payment events route (below; call the same
`markPaid`).

## Subscriptions — a monthly plan, a members-only page

`mode: 'subscription'` with `recurring: { interval: 'month' }` on the item (or `'year'`, `'week'`, `'day'`; no Stripe
setup). Store the member's subscription on return; access = `status` `'active'`/`'trialing'` and the paid period
not over.

```ts
// src/db/schema.ts — one row per member (index: the primary key)
export const memberships = sqliteTable('memberships', {
  userId: text().primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  subscriptionId: text().notNull(),
  customerId: text().notNull(),
  status: text().notNull(), // Stripe's: 'active', 'trialing', 'past_due', 'canceled', …
  currentPeriodEnd: text(), // ISO: the next renewal, or the end of access after "cancel at period end"
});

// src/lib/membership.ts
export const isMember = (m?: { status: string; currentPeriodEnd: string | null } | null) =>
  !!m && ['active', 'trialing'].includes(m.status) && (m.currentPeriodEnd ?? '') > new Date().toISOString();
/** Stores what Stripe says now (after checkout, after a cancel, or once the stored period is over). */
export async function syncMembership(userId: string, subscriptionId: string) {
  const s = await totalum.payments.subscriptions.get(subscriptionId);
  const row = { userId, subscriptionId, customerId: s.customerId, status: s.status, currentPeriodEnd: s.currentPeriodEnd };
  await db.insert(memberships).values(row).onConflictDoUpdate({ target: memberships.userId, set: row });
  return row;
}
```

- `POST /api/subscribe` (signed-in user, else 401): `createCheckout({ mode: 'subscription', lineItems: [{ name:
  'Membership', unitAmount: 999, currency: 'eur', quantity: 1, recurring: { interval: 'month' } }], customerEmail:
  user.email, metadata: { userId: user.id }, successUrl: `${site}/api/subscribe/return?session_id={CHECKOUT_SESSION_ID}`,
  cancelUrl: `${site}/join` })` → `{ url }`.
- `GET /api/subscribe/return` (the one GET that writes): `const s = await totalum.payments.getCheckout(id)`; when
  `s.status === 'complete' && s.subscriptionId && s.metadata.userId === user.id` → `syncMembership(user.id,
  s.subscriptionId)`; redirect 303 to `/members`.
- Members page: `loadPage((me) => [db.select().from(memberships).where(eq(memberships.userId, me))])`; no row or
  `!isMember(row)` → show the join page. Safety net: a stored `'active'` row whose `currentPeriodEnd` has passed →
  `syncMembership` once (`subscriptions.get`; Stripe may have renewed it), then decide; never refuse on the stale row.
- Cancel (POST): `totalum.payments.subscriptions.cancel(id)` ends it now; `.update(id, { cancelAtPeriodEnd: true })`
  keeps access to the period's end. Then `syncMembership`. `totalum.payments.customerPortalLink({ customerId, returnUrl })`
  is Stripe's page to change the card, see invoices or cancel.
- Renewals, failed payments and cancellations reach the payment events route as
  `payments.customer.subscription.updated|deleted` and `payments.invoice.payment_failed` (`data.object.metadata.userId`).

## Payment events — `src/app/api/webhooks/stripe/route.ts`, automatic

Totalum delivers every payment event to the app's own `src/app/api/webhooks/stripe/route.ts` (POST) by itself: test
payments' events on the preview, real payments' events on the published site (its custom domain too). Nobody sets
anything up: **never ask the user to set up or turn on a webhook**, never give them a URL to paste. The events are
signed by Totalum, not Stripe: `const event = await totalum.webhooks.verify(await req.text(), req.headers)` (a
`TotalumWebhookError` → 400; never `stripe-signature`), then by `event.type` call the same `markPaid` /
`syncMembership` (by `data.object.metadata`), answer 200 (also to types you ignore). Its secret,
`TOTALUM_WEBHOOK_SECRET`, is set by Totalum on the preview, the published site and here (a rotation too):
never ask the user to add it, never pass it. Never poll Stripe instead. An app built earlier may have
`src/app/api/webhooks/totalum/route.ts` (an address the owner set): keep it working, and when you touch payments add
the stripe route calling the same handlers (both may get an event: the handlers do nothing the second time).

Errors: `PAYMENTS_NOT_ENABLED` (403: payments are not available — show "Payments coming soon" and tell the user in
your final message to connect Stripe in the Payments settings), `PAYMENTS_LIVE_ONBOARDING_REQUIRED` (403: the Stripe
account cannot take real payments yet — show "Payments are paused" and tell the user to finish connecting Stripe in the
Payments settings),
`CARD_DATA_NOT_ACCEPTED` (never send card numbers), `STRIPE_ERROR` (the message says why), `STRIPE_RATE_LIMITED`.

## The user's own Stripe keys (only when they ask)

Only when the user asks to use their own Stripe account with their own keys instead of the above: they add
`STRIPE_SECRET_KEY` (and, for webhooks, `STRIPE_WEBHOOK_SECRET`) under **Secrets** in the project menu, never in the
chat; never ask for or print the value. Then `npm install stripe` and, on the server only (a route handler or server
action; never a `'use client'` file, never `NEXT_PUBLIC_*`, never logged or returned):
`const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)`, e.g. `stripe.checkout.sessions.create({ … })`. Their
events come from Stripe itself, signed by Stripe, to the same path: `src/app/api/webhooks/stripe/route.ts` (POST)
verifies **Stripe's** signature with `await stripe.webhooks.constructEventAsync(await req.text(),
req.headers.get('stripe-signature') ?? '', process.env.STRIPE_WEBHOOK_SECRET!)` (a throw → 400), never
`totalum.webhooks.verify`; here (and only here) tell the user to add `<site>/api/webhooks/stripe` as an endpoint in
their Stripe Dashboard. One way per app: own keys → Stripe's signature; `totalum.payments` → Totalum's. No key yet →
show "Payments coming soon" and say where to add it. Their key decides test or live (`sk_test_…` / `sk_live_…`).
