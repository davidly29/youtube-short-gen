# Instagram Reels (E8-04, E8-04b, H-09)

E8-04 ships the provider (`packages/providers/src/instagram`): Instagram Login, the `content_publishing_limit`
check, a `REELS` container polled once a minute for at most 5 minutes, then publish. Rate limits and a used-up 24-hour
publishing limit come back as `scheduled_next_window` (retry in an hour) rather than failures, and personal accounts
get a "switch to Professional" message. E8-04b adds the connect page and the publish job; tests use
`FakeInstagram`.

## What users get (E8-04b)

- **Connect**: on an approved Short, _Post it to Instagram as a Reel_ → **Connect Instagram**
  (`/publish/instagram/connect` → Instagram Login → `/publish/instagram/callback`, CSRF state in an httpOnly cookie).
  Personal accounts see the "switch to Professional" message and nothing is stored. The long-lived (60-day) token is
  sealed (AES-GCM) in `channels.secret` together with its expiry.
- **Post**: the Reel is queued as a `publish` job (`platform: "instagram"`). The job re-runs the YouTube checks
  (approved, rights manifest, music check, variation guard), refreshes the token when under 7 days are left, sends a
  signed render URL and the caption with licence credits (2,200 characters max, credits kept), then polls
  Instagram's processing once a minute for up to 5 minutes. The post page shows the permalink when it's live.
- **Limits**: a rate limit or a used-up 24-hour publishing limit holds the post as `scheduled_next_window` with a
  `retryAt` one hour later; the 10-minute sweep (`requeueHeldPublishes`) sends it again after that.
- **Disconnect**: from the post page or Channels. Instagram Login has no revoke call, so we forget the token; users
  can also remove ShortLoop under Instagram → Settings → Website permissions → Apps and websites.

## Operator setup

1. A Meta app at <https://developers.facebook.com/> with the **Instagram** product, using **Instagram API with
   Instagram Login** (not Facebook Login).
2. Permissions `instagram_business_basic` and `instagram_business_content_publish`; App Review (H-09) is required
   before accounts outside the app's roles can connect.
3. OAuth redirect URI: `https://web-staging-0f0b5.up.railway.app/publish/instagram/callback`.
4. Railway variables on `web` **and** `worker` (the worker runs the publish job in queue mode):
   `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, plus `BETTER_AUTH_URL` (or `APP_URL`) on the worker so it can build
   the same redirect URI and absolute media links. Never put them in the repo or in chat.
5. Video URLs must be publicly fetchable by Meta for a few minutes: signed R2 URLs work.

Only Professional (Business or Creator) Instagram accounts can be published to.
