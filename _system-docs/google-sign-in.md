# Sign in with Google

(To use a user's Google Calendar, Meet, Gmail or Drive — create events, send e-mail — read
`totalum-sdk/connections.md` instead: no Google Cloud setup at all.)

It is built in. `/login` and `/register` show **Continue with Google** as soon as the project has two secrets,
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Totalum applies a new secret to the preview and the live site at once.

- Never edit `src/lib/auth.ts` and never add another auth library.
- Never ask for the client id or secret in the chat. Only the user adds them, under Secrets.
- The app needs `accounts: true` in `src/lib/site.ts`.
- If you restyle `/login` or `/register`, keep `<AuthForm google={googleClient() !== null} … />` and the page's
  `await connection()`. A button of your own is shown only when `googleClient()` (`@/lib/auth`) is set, and calls
  `signIn.social({ provider: 'google', callbackURL: '/' })` (`@/lib/auth-client`).

## What to tell the user

When the user asks for Google sign-in, give them these 3 steps. Use the real addresses from `<project-facts>`, never
placeholders:

1. In Google Cloud (console.cloud.google.com), pick or create a project and open **Google Auth Platform**:
   - under **Branding**, enter the app's name and a support e-mail;
   - under **Audience**, choose **External**, then **Publish app**.
2. In **Clients**, choose **Create client** → **Web application**. Under **Authorized redirect URIs**, add both of
   these:
   - `<live site>/api/auth/callback/google`
   - `<dev preview>/api/auth/callback/google`

   Add `https://<domain>/api/auth/callback/google` too for each custom domain.
3. Copy the **Client ID** and **Client secret** into Totalum: open the project menu → **Secrets** and add them as
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (environment: both). The button then appears on the preview. The
   live site shows it after the next publish, if it has not been published since Google sign-in was added.

Also tell them:

- The preview address changes every month. When it changes, Google sign-in on the preview needs the new redirect
  URI. The live address never changes.
- Inside Totalum's preview panel, the button opens the preview in a new tab, because Google never opens inside a frame.
- If someone already has an account with that e-mail and a password, they sign in with the password first and
  confirm the e-mail on `/account`. Google then works for the same account.
