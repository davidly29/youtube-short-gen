# Google OAuth client for YouTube publishing (H-02)

ShortLoop uses one Google OAuth client for two things: **connecting YouTube channels** (E8-01) and, optionally,
**"Sign in with Google"**. Until it's set, the Channels page says publishing isn't switched on.

1. Go to <https://console.cloud.google.com/> and create a project, e.g. `ShortLoop`.
2. **APIs & Services → Library**: enable **YouTube Data API v3** (and YouTube Analytics API for E10 later).
3. **OAuth consent screen**: User type **External**. App name `ShortLoop`, your support email, and the app domain.
   Add scopes `.../auth/youtube.upload` and `.../auth/youtube.readonly`. While the app is in **Testing**, add your
   own Google account (and any beta users) under **Test users**. Only they can connect until Google verifies the app.
4. **Credentials → Create credentials → OAuth client ID → Web application**. Authorised redirect URIs:
   - `https://web-staging-0f0b5.up.railway.app/api/channels/youtube/callback`
   - `https://web-staging-0f0b5.up.railway.app/api/auth/callback/google` (Google sign-in)
   - `http://localhost:3000/api/channels/youtube/callback` and `http://localhost:3000/api/auth/callback/google` (local dev)
5. In Railway → `shortloop` → `staging` → `web` → Variables, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
   Never put them in the repo or in chat.
6. Open the app → **Channels → Connect YouTube channel**, approve both permissions, then publish an approved Short.

Notes

- Default API quota is 10,000 units/day per Google project and an upload costs about 1,600 units, so expect roughly
  **6 uploads a day** until the quota extension (H-08) is granted. Set `YOUTUBE_DAILY_UPLOAD_LIMIT=6` on `web` to
  match. Extra posts wait for the next window (midnight Pacific) and go out automatically.
- Uploads from unverified apps may be locked as private by YouTube until the app passes Google's audit (H-08).
- Before public launch, submit the consent screen for verification (sensitive scopes).
