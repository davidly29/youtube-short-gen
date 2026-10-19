import { DEFAULT_MODELS, type ApiKeyProvider } from "@shortloop/contracts";

export interface ProviderMeta {
  id: ApiKeyProvider;
  name: string;
  uses: string[];
  blurb: string;
  getKeyUrl: string;
  placeholder: string;
  textModel?: string;
  imageModel?: string;
}

/** Display order: Gemini first because one key covers scripts and images. */
export const PROVIDERS: ProviderMeta[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    uses: ["Scripts", "AI images"],
    blurb:
      "Scripts and (optionally) images. The free tier covers scripts only: Google gives free keys no image quota, so turn on billing before picking Gemini for images.",
    getKeyUrl: "https://aistudio.google.com/apikey",
    placeholder: "AIza…",
    textModel: DEFAULT_MODELS.gemini.text,
    imageModel: DEFAULT_MODELS.gemini.image,
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    uses: ["Scripts"],
    blurb: "Writes scripts with Claude.",
    getKeyUrl: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-…",
    textModel: DEFAULT_MODELS.anthropic.text,
  },
  {
    id: "openai",
    name: "OpenAI",
    uses: ["Scripts"],
    blurb: "Writes scripts with GPT models.",
    getKeyUrl: "https://platform.openai.com/api-keys",
    placeholder: "sk-…",
    textModel: DEFAULT_MODELS.openai.text,
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    uses: ["Voice"],
    blurb: "Natural voices cleared for commercial use. Without it, Shorts use free built-in voices.",
    getKeyUrl: "https://elevenlabs.io/app/settings/api-keys",
    placeholder: "sk_…",
  },
  {
    id: "pexels",
    name: "Pexels",
    uses: ["Stock footage"],
    blurb: "Free licensed stock photos and video. Used before AI images.",
    getKeyUrl: "https://www.pexels.com/api/",
    placeholder: "Your Pexels API key",
  },
  {
    id: "pixabay",
    name: "Pixabay",
    uses: ["Stock footage"],
    blurb: "Free licensed stock, a second source alongside Pexels.",
    getKeyUrl: "https://pixabay.com/api/docs/",
    placeholder: "Your Pixabay API key",
  },
  {
    id: "fal",
    name: "fal.ai",
    uses: ["AI images"],
    blurb: "Fast Flux image generation.",
    getKeyUrl: "https://fal.ai/dashboard/keys",
    placeholder: "Your fal key",
    imageModel: DEFAULT_MODELS.fal.image,
  },
];

export const PROVIDER_NAME: Record<string, string> = {
  ...Object.fromEntries(PROVIDERS.map((p) => [p.id, p.name])),
  edge: "Free built-in voices",
  pollinations: "Free AI images (Pollinations)",
  fake: "Test provider",
};
