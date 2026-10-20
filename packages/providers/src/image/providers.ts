import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Asset, DEFAULT_MODELS } from "@shortloop/contracts";
import type { Storage } from "../storage";
import { join } from "node:path";
import { runFfmpeg } from "../media/ffmpeg";
import { httpError } from "../errors";
import { geminiGenerate } from "../llm/gemini";
import {
  checkImagePrompt,
  fullPrompt,
  generationSize,
  ImagePromptRejected,
  type ImageGen,
  type ImageRequest,
  type ImageResult,
} from "./image";

abstract class BaseImageGen implements ImageGen {
  abstract readonly provider: string;
  abstract readonly model: string;
  /** Image bytes, or bytes plus the file extension when the provider decides the format. */
  protected abstract render(
    prompt: string,
    req: ImageRequest,
  ): Promise<Buffer | { data: Buffer; ext: string }>;
  protected readonly ext: string = "jpg";

  async generate(req: ImageRequest): Promise<ImageResult> {
    const verdict = checkImagePrompt(req.prompt);
    if (!verdict.ok) throw new ImagePromptRejected(verdict.reason);
    const prompt = fullPrompt(req.prompt, req.style);
    const out = await this.render(prompt, req);
    const [data, ext] = Buffer.isBuffer(out) ? [out, this.ext] : [out.data, out.ext];
    const path = join(req.outDir, `${randomUUID()}.${ext}`);
    await writeFile(path, data);
    return { path, provider: this.provider, model: this.model, prompt };
  }
}

/** Pollinations: free, no key, Flux-based. Rate limited; fine for dev and early beta. */
export class PollinationsImage extends BaseImageGen {
  readonly provider = "pollinations";
  readonly model = "flux";
  constructor(private readonly fetchImpl: typeof fetch = fetch) {
    super();
  }
  protected async render(prompt: string, req: ImageRequest): Promise<Buffer> {
    const { width, height } = generationSize(req.aspect);
    const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`);
    url.search = new URLSearchParams({
      width: String(width),
      height: String(height),
      model: this.model,
      nologo: "true",
      seed: String(req.seed ?? Math.floor(Math.random() * 2 ** 31)),
    }).toString();
    const res = await this.fetchImpl(url);
    if (!res.ok) throw await httpError("pollinations", "image", res);
    return Buffer.from(await res.arrayBuffer());
  }
}

/** fal.ai (FAL_KEY), Flux schnell by default. */
export class FalImage extends BaseImageGen {
  readonly provider = "fal";
  constructor(
    private readonly key: string,
    readonly model: string = DEFAULT_MODELS.fal.image,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }
  protected async render(prompt: string, req: ImageRequest): Promise<Buffer> {
    const res = await this.fetchImpl(`https://fal.run/${this.model}`, {
      method: "POST",
      headers: { authorization: `Key ${this.key}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt, image_size: generationSize(req.aspect), num_images: 1, seed: req.seed }),
    });
    if (!res.ok) throw await httpError("fal", "image", res);
    const data = (await res.json()) as { images: { url: string }[] };
    const img = data.images[0];
    if (!img) throw new Error("fal returned no image");
    const file = await this.fetchImpl(img.url);
    return Buffer.from(await file.arrayBuffer());
  }
}

/** Default Gemini image model ("Nano Banana"); users can override it in Settings. */
export const GEMINI_IMAGE_MODEL = DEFAULT_MODELS.gemini.image;

/** Google Gemini native image generation with the user's AI Studio key. */
export class GeminiImage extends BaseImageGen {
  readonly provider = "gemini";
  constructor(
    private readonly key: string,
    readonly model: string = GEMINI_IMAGE_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }
  protected async render(prompt: string, req: ImageRequest): Promise<{ data: Buffer; ext: string }> {
    const data = await geminiGenerate(
      this.fetchImpl,
      this.key,
      this.model,
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: req.aspect } },
      },
      "image",
    );
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData) throw new Error("Gemini returned no image");
    return {
      data: Buffer.from(part.inlineData.data, "base64"),
      ext: part.inlineData.mimeType === "image/jpeg" ? "jpg" : "png",
    };
  }
}

/** Offline image for tests: a colour derived from the prompt hash. */
export class FakeImage extends BaseImageGen {
  readonly provider = "fake";
  readonly model = "fake-1";
  protected override readonly ext = "png";
  protected async render(prompt: string, req: ImageRequest): Promise<Buffer> {
    const { width, height } = generationSize(req.aspect);
    const colour = createHash("md5").update(prompt).digest("hex").slice(0, 6);
    const tmp = join(req.outDir, `${randomUUID()}.png`);
    await runFfmpeg(["-f", "lavfi", "-i", `color=c=0x${colour}:s=${width}x${height}`, "-frames:v", "1", tmp]);
    return readFile(tmp);
  }
}

/** IMAGE_PROVIDER=fal|pollinations|fake. Default: fal with a key, else Pollinations. */
export function imageFromEnv(env: NodeJS.ProcessEnv = process.env): ImageGen {
  const p = env.IMAGE_PROVIDER ?? (env.FAL_KEY ? "fal" : "pollinations");
  if (p === "fal") {
    if (!env.FAL_KEY) throw new Error("IMAGE_PROVIDER=fal needs FAL_KEY");
    return new FalImage(env.FAL_KEY, env.FAL_IMAGE_MODEL);
  }
  if (p === "fake") return new FakeImage();
  return new PollinationsImage();
}

/** Generate an image and store it as an AI-generated Asset with provider, model and prompt in its licence. */
export async function generateImageAsset(
  gen: ImageGen,
  storage: Storage,
  ownerId: string,
  req: Omit<ImageRequest, "outDir">,
): Promise<Asset> {
  const dir = await mkdtemp(join(tmpdir(), "img-"));
  try {
    const r = await gen.generate({ ...req, outDir: dir });
    const ext = r.path.split(".").pop() ?? "jpg";
    const id = `ast_${randomUUID()}`;
    const storageKey = `assets/${ownerId}/${id}.${ext}`;
    await storage.putFile(storageKey, r.path, ext === "png" ? "image/png" : "image/jpeg");
    const size = generationSize(req.aspect);
    return Asset.parse({
      id,
      ownerId,
      kind: "image",
      source: "ai_generated",
      licence: { type: "ai_generated", provider: r.provider, model: r.model, prompt: r.prompt },
      storageKey,
      width: size.width,
      height: size.height,
      createdAt: new Date().toISOString(),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
