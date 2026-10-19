/**
 * Replays recorded HTTP exchanges in order. Each request must match the next entry's method and URL
 * (and any listed request headers), so a test fails loudly if the client's calls drift from the recording.
 */
export interface CassetteEntry {
  request: { method: string; url: string; headers?: Record<string, string> };
  response: { status: number; headers?: Record<string, string>; body?: unknown };
}

export interface Cassette {
  fetch: typeof fetch;
  /** Requests actually made, for assertions on bodies. */
  calls: { method: string; url: string; headers: Record<string, string>; body?: unknown }[];
  /** Throws if some recorded exchanges were never played. */
  assertDone(): void;
}

export function cassette(entries: CassetteEntry[]): Cassette {
  let i = 0;
  const calls: Cassette["calls"] = [];
  const f = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : init?.body;
    calls.push({ method, url, headers, body });
    const e = entries[i++];
    if (!e) throw new Error(`cassette: unexpected request ${method} ${url}`);
    if (e.request.method !== method || e.request.url !== url) {
      throw new Error(`cassette: expected ${e.request.method} ${e.request.url}, got ${method} ${url}`);
    }
    for (const [k, v] of Object.entries(e.request.headers ?? {})) {
      if (headers[k.toLowerCase()] !== v)
        throw new Error(`cassette: header ${k} was ${headers[k.toLowerCase()]}, expected ${v}`);
    }
    const resBody = e.response.body === undefined ? null : JSON.stringify(e.response.body);
    return new Response(e.response.status === 204 ? null : resBody, {
      status: e.response.status,
      headers: { "content-type": "application/json", ...(e.response.headers ?? {}) },
    });
  };
  return {
    fetch: f as typeof fetch,
    calls,
    assertDone() {
      if (i !== entries.length)
        throw new Error(`cassette: ${entries.length - i} recorded request(s) never made`);
    },
  };
}
