import { PexelsStock } from "./pexels";
import { PixabayStock } from "./pixabay";
import { FakeStock } from "./fake";
import type { StockProvider } from "./stock";

export * from "./stock";
export { PexelsStock } from "./pexels";
export { PixabayStock } from "./pixabay";
export { FakeStock } from "./fake";

/** All configured stock providers, Pexels first (PEXELS_API_KEY, PIXABAY_API_KEY; STOCK_PROVIDER=fake for tests). */
export function stockFromEnv(env: NodeJS.ProcessEnv = process.env): StockProvider[] {
  if (env.STOCK_PROVIDER === "fake") return [new FakeStock()];
  const providers: StockProvider[] = [];
  if (env.PEXELS_API_KEY) providers.push(new PexelsStock(env.PEXELS_API_KEY));
  if (env.PIXABAY_API_KEY) providers.push(new PixabayStock(env.PIXABAY_API_KEY));
  return providers;
}
