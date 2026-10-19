import type { z } from "zod";
import type {
  ApproveOutput,
  Balance,
  CaptionStyle,
  CreateShortInput,
  CreateShortOutput,
  EstimateInput,
  EstimateOutput,
  JobView,
  PublishInput,
  PublishOutput,
  SwapVisualInput,
  TrendsInput,
  TrendsOutput,
  Voice,
} from "./schemas";

/**
 * Everything the MCP tools can do, for one signed-in user. The web app implements this with the same service
 * functions its own pages use, so the MCP layer holds no business logic (E9-01).
 * Methods throw `ToolUserError` for problems the agent should relay to the user.
 */
export interface ShortLoopServices {
  getTrends(input: z.output<typeof TrendsInput>): Promise<z.output<typeof TrendsOutput>>;
  createShort(input: z.output<typeof CreateShortInput>): Promise<z.output<typeof CreateShortOutput>>;
  getJob(jobId: string): Promise<JobView>;
  listVoices(): Promise<z.output<typeof Voice>[]>;
  listCaptionStyles(): Promise<z.output<typeof CaptionStyle>[]>;
  estimateCost(input: z.output<typeof EstimateInput>): Promise<z.output<typeof EstimateOutput>>;
  swapVisual(input: z.output<typeof SwapVisualInput>): Promise<JobView>;
  approveShort(projectId: string): Promise<z.output<typeof ApproveOutput>>;
  publishShort(input: z.output<typeof PublishInput>): Promise<z.output<typeof PublishOutput>>;
  getCreditBalance(): Promise<z.output<typeof Balance>>;
}

/** A message safe to show the user (e.g. "Approve the Short before publishing."). */
export class ToolUserError extends Error {}
