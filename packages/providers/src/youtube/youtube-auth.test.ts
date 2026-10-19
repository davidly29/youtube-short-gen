import { describe, expect, it } from "vitest";
import { cassette } from "../testing/cassette";
import { HttpYouTube, ReconnectRequired, YOUTUBE_SCOPES, youtubeFromEnv } from ".";

const config = {
  clientId: "cid.apps.googleusercontent.com",
  clientSecret: "csecret",
  redirectUri: "https://app.test/api/channels/youtube/callback",
};
const TOKEN = "https://oauth2.googleapis.com/token";

describe("YouTube OAuth (E8-01)", () => {
  it("asks only for upload + readonly, offline access, and carries the state", () => {
    const u = new URL(new HttpYouTube(config).authUrl("state-123"));
    expect(u.searchParams.get("scope")?.split(" ")).toEqual([...YOUTUBE_SCOPES]);
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("state")).toBe("state-123");
    expect(u.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("exchanges the code for a refresh token and reads the channel", async () => {
    const c = cassette([
      {
        request: { method: "POST", url: TOKEN },
        response: {
          status: 200,
          body: { access_token: "at", refresh_token: "rt", scope: YOUTUBE_SCOPES.join(" ") },
        },
      },
      {
        request: {
          method: "GET",
          url: "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
          headers: { authorization: "Bearer at" },
        },
        response: {
          status: 200,
          body: {
            items: [
              {
                id: "UC123",
                snippet: {
                  title: "Octo Facts",
                  thumbnails: { default: { url: "https://yt3.ggpht.com/a.jpg" } },
                },
              },
            ],
          },
        },
      },
    ]);
    const yt = new HttpYouTube(config, c.fetch);
    expect(await yt.exchangeCode("code-1")).toMatchObject({ refreshToken: "rt", accessToken: "at" });
    expect(String(c.calls[0]?.body)).toContain("grant_type=authorization_code");
    expect(await yt.myChannel("at")).toEqual({
      id: "UC123",
      title: "Octo Facts",
      avatarUrl: "https://yt3.ggpht.com/a.jpg",
    });
    c.assertDone();
  });

  it("refuses a grant without upload permission (user unticked it on the consent screen)", async () => {
    const c = cassette([
      {
        request: { method: "POST", url: TOKEN },
        response: {
          status: 200,
          body: { access_token: "at", refresh_token: "rt", scope: YOUTUBE_SCOPES[1] },
        },
      },
    ]);
    await expect(new HttpYouTube(config, c.fetch).exchangeCode("x")).rejects.toThrow(/Upload permission/);
  });

  it("an expired or revoked grant becomes ReconnectRequired, not a silent failure", async () => {
    const c = cassette([
      {
        request: { method: "POST", url: TOKEN },
        response: {
          status: 400,
          body: { error: "invalid_grant", error_description: "Token has been expired or revoked." },
        },
      },
    ]);
    await expect(new HttpYouTube(config, c.fetch).accessToken("old")).rejects.toBeInstanceOf(
      ReconnectRequired,
    );
  });

  it("an account without a channel gets a clear message", async () => {
    const c = cassette([
      {
        request: {
          method: "GET",
          url: "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        },
        response: { status: 200, body: { items: [] } },
      },
    ]);
    await expect(new HttpYouTube(config, c.fetch).myChannel("at")).rejects.toThrow(/no YouTube channel/);
  });

  it("revokes by posting the token, and is configured from env only when complete", async () => {
    const c = cassette([
      {
        request: { method: "POST", url: "https://oauth2.googleapis.com/revoke" },
        response: { status: 200, body: {} },
      },
    ]);
    await new HttpYouTube(config, c.fetch).revoke("rt");
    expect(String(c.calls[0]?.body)).toBe("token=rt");
    expect(youtubeFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(
      youtubeFromEnv({
        GOOGLE_CLIENT_ID: "a",
        GOOGLE_CLIENT_SECRET: "b",
        BETTER_AUTH_URL: "https://x.test",
      } as unknown as NodeJS.ProcessEnv),
    ).toBeInstanceOf(HttpYouTube);
  });
});
