# TikTok posting (E8-03, H-01)

Until these are set the Channels page has no TikTok card and the TikTok post page says posting isn't switched on.
Tests and e2e use `FakeTikTok` (`SHORTLOOP_FAKE_PROVIDERS=1`), so none of this is needed for CI.

1. Create an app at <https://developers.tiktok.com/> (Manage apps → Connect an app). Add the products **Login Kit**
   and **Content Posting API**, and turn on **Direct Post** in the Content Posting settings.
2. Scopes: `user.info.basic` and `video.publish` only.
3. Login Kit → Redirect URI: `https://web-staging-0f0b5.up.railway.app/publish/tiktok/callback` (and
   `http://localhost:3000/publish/tiktok/callback` for local dev if TikTok allows it for your app).
4. Content Posting → **URL properties**: verify the domain (or URL prefix) that serves rendered videos. With R2 that
   is the bucket's public/custom domain used by signed URLs; with local storage it is the app domain (`/api/files/`).
   TikTok refuses `PULL_FROM_URL` from unverified domains (`url_ownership_unverified`).
5. In Railway → `shortloop` → `staging` → `web` → Variables, add `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.
   Never put them in the repo or in chat.
6. Leave `TIKTOK_AUDITED` unset. Unaudited apps can only post as "Only me" to private TikTok accounts, and the UI says
   so. File the audit (H-01) using `docs/tiktok-audit.md`; set `TIKTOK_AUDITED=1` only after TikTok approves it.

Notes

- Access tokens last 24 hours; we store only the refresh token (encrypted with `SHORTLOOP_SECRETS_KEY`, like YouTube)
  and keep the newest one TikTok returns on each refresh.
- TikTok limits how many posts a creator can make per day and how many accounts an unaudited app can post for; those
  errors are shown to the user instead of the form.
- Posting happens from the web app (Direct Post init is quick, then TikTok downloads the file itself); the post's
  status is refreshed each time the TikTok page is opened.
