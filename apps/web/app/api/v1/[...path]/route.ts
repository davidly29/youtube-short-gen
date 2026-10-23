import { handleApiRequest } from "../../../../src/server/api/router";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // GET /jobs/{id}?wait= holds a request for up to 50 s

/** Public REST API (E12-01). Spec: /api/v1/openapi.json and docs/api/openapi.yaml. */
const handle = (req: Request) => handleApiRequest(req);

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const PUT = handle;
export const PATCH = handle;
