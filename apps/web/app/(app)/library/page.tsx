import { Film, ImageIcon, Music } from "lucide-react";
import { Uploader } from "../../../src/components/uploader";
import { Badge, Card } from "../../../src/components/ui";
import { requireUser } from "../../../src/server/auth";
import { listLibrary } from "../../../src/server/library";

const ICON = { video: Film, image: ImageIcon, audio: Music } as const;
const secs = (ms?: number | null) => (ms ? `${(ms / 1000).toFixed(1)} s` : "");

export default async function LibraryPage() {
  const user = await requireUser();
  const items = await listLibrary(user.id);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Library</h1>
      <Uploader />
      {items.length === 0 ? (
        <p className="text-sm text-ink-soft" data-testid="empty-library">
          Nothing here yet. Stock and AI visuals are added automatically; uploads are for your own footage.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" data-testid="library-grid">
          {items.map((a) => {
            const Icon = ICON[a.kind];
            return (
              <li key={a.id}>
                <Card className="overflow-hidden p-0">
                  <div className="flex aspect-[9/16] items-center justify-center bg-paper">
                    {a.kind === "image" ? (
                      <img src={a.url} alt={a.title} className="size-full object-cover" />
                    ) : a.kind === "video" ? (
                      <video src={a.url} className="size-full object-cover" muted preload="metadata" />
                    ) : (
                      <Icon className="size-8 text-ink-soft" aria-hidden />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="truncate text-sm font-medium" title={a.title}>
                      {a.title}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-ink-soft">
                      <Badge tone="good">owned</Badge>
                      {a.width && a.height ? `${a.width}×${a.height}` : ""} {secs(a.durationMs)}
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
