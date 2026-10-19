/**
 * Next.js instrumentation (E13-02): tracing and error reporting for the web server.
 * Nothing is exported unless OTEL_EXPORTER_OTLP_ENDPOINT / SENTRY_DSN are set (see infra/otel/README.md).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initTelemetry } = await import("@shortloop/pipeline/tracing");
  await initTelemetry({ serviceName: "shortloop-web" });
}

/** Server errors from route handlers, server actions and rendering go to Sentry when it is configured. */
export async function onRequestError(error: unknown) {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  const { reportError } = await import("@shortloop/pipeline/tracing");
  reportError(error);
}
