import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../../src/server/auth";

export async function GET(req: Request) {
  return toNextJsHandler(await auth()).GET(req);
}
export async function POST(req: Request) {
  return toNextJsHandler(await auth()).POST(req);
}
