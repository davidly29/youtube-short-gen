# Instagram Reels (E8-04, H-09)

E8-04 ships the provider only (`packages/providers/src/instagram`): Instagram Login, the `content_publishing_limit`
check, a `REELS` container polled once a minute for at most 5 minutes, then publish. Rate limits and a used-up 24-hour
publishing limit come back as `scheduled_next_window` (retry in an hour) rather than failures, and personal accounts
get a "switch to Professional" message. The connect page and publish job are a follow-up ticket; tests use
`FakeInstagram`.

When that UI lands, the operator needs:

1. A Meta app at <https://developers.facebook.com/> with the **Instagram** product, using **Instagram API with
   Instagram Login** (not Facebook Login).
2. Permissions `instagram_business_basic` and `instagram_business_content_publish`; App Review (H-09) is required
   before accounts outside the app's roles can connect.
3. OAuth redirect URI: `https://web-staging-0f0b5.up.railway.app/publish/instagram/callback`.
4. Railway variables on `web` (and `worker` once publishing runs there): `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`.
   Never put them in the repo or in chat.
5. Video URLs must be publicly fetchable by Meta for a few minutes: signed R2 URLs work.

Only Professional (Business or Creator) Instagram accounts can be published to.
