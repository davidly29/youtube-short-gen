# Music check on uploaded audio (E13-03)

Before a Short is published, every **user-supplied audio** asset on its audio track (source `upload` or
`own_channel`) is sent to an audio-recognition service. If any recording is matched with **confidence above 0.8**,
the publish is refused with a message naming the track and its rights owner. Audio from the in-app music library
(`library_music`) is never blocked; AI voices and licensed stock aren't sent for recognition. Video clips are
rendered muted, so they can't carry music into a Short.

The result is part of the publish's audit record (`checks.music`: `passed`, `failed` or `skipped`, plus the matches),
so "Explain this publish" shows it.

## Provider: ACRCloud

This is a platform safety check paid by the operator, not a bring-your-own-key feature (ADR 0006 covers AI
generation only).

1. Create an ACRCloud account and an **Audio & Video Recognition** project using the music bucket
   (ACRCloud Music). Set a usage cap in the console.
2. Copy the project's host (e.g. `identify-eu-west-1.acrcloud.com`), access key and access secret.
3. In Railway, set on **both** `web` and `worker`:

| Variable                 | Value                                                       |
| ------------------------ | ----------------------------------------------------------- |
| `ACRCLOUD_HOST`          | the project host, without `https://`                        |
| `ACRCLOUD_ACCESS_KEY`    | the project access key                                      |
| `ACRCLOUD_ACCESS_SECRET` | the project access secret (Railway only, never in the repo) |
| `FINGERPRINT_REQUIRED`   | optional: `1` to refuse uploaded audio while unconfigured   |

Each audio file is sampled as up to six 12-second clips spread over its first 180 seconds (one per 30 s), so a
45-second track costs two recognition calls. Provider errors make the publish job retry; they never let it pass.

## Without a provider

With no ACRCloud variables, publishes that include uploaded audio go ahead and the check is recorded as `skipped`.
Set `FINGERPRINT_REQUIRED=1` to refuse them instead.

## Tests and fake mode

Tests use `FakeFingerprint` (no network). With `SHORTLOOP_FAKE_PROVIDERS=1` (or `FINGERPRINT_PROVIDER=fake`), an
upload whose title or storage key contains `commercial-music` matches a made-up track at 95%, so the blocked path
can be demoed.
