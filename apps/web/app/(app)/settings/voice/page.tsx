import { MIN_STYLE_VIDEOS } from "@shortloop/contracts";
import Link from "next/link";
import { ChannelVoiceEditor } from "../../../../src/components/channel-voice";
import { Card } from "../../../../src/components/ui";
import { requireUser } from "../../../../src/server/auth";
import { listChannelVoices } from "../../../../src/server/style";

export default async function VoicePage() {
  const user = await requireUser();
  const voices = await listChannelVoices(user.id);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Channel voice</h1>
        <p className="mt-1 text-sm text-ink-soft">
          ShortLoop reads the titles and descriptions of your own published videos (at least{" "}
          {MIN_STYLE_VIDEOS}) to learn how you write, so scripts sound like you. Nothing is downloaded, and no
          other channel’s content is used. Edit anything it got wrong.
        </p>
      </div>
      {voices.length === 0 ? (
        <Card data-testid="voice-no-channels">
          <p className="text-sm text-ink-soft">
            Connect your YouTube channel first on{" "}
            <Link href="/channels" className="font-medium text-brand underline">
              Channels
            </Link>
            .
          </p>
        </Card>
      ) : (
        voices.map((v) => (
          // Re-mount after a (re)build so local state starts from the stored profile.
          <ChannelVoiceEditor
            key={`${v.channel.id}-${v.style?.builtAt ?? ""}`}
            channel={v.channel}
            style={v.style}
          />
        ))
      )}
    </div>
  );
}
