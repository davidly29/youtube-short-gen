import {
  context,
  defaultTextMapGetter,
  defaultTextMapSetter,
  isSpanContextValid,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

/**
 * Tracing for web → queue → worker (E13-02). Everything here is a no-op until `initTelemetry` registers a
 * tracer provider, so tests and local runs that never call it pay nothing and make no network calls.
 */

const TRACER = "shortloop";
const propagator = new W3CTraceContextPropagator();

/** Run `fn` inside a new active span; errors are recorded on the span and rethrown. */
export async function withSpan<T>(
  name: string,
  attrs: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return trace.getTracer(TRACER).startActiveSpan(name, { attributes: attrs }, async (span) => {
    try {
      return await fn(span);
    } catch (e) {
      span.recordException(e instanceof Error ? e : String(e));
      span.setStatus({ code: SpanStatusCode.ERROR, message: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      span.end();
    }
  });
}

/** Trace id of the active span, if any. */
export function currentTraceId(): string | undefined {
  const sc = trace.getActiveSpan()?.spanContext();
  return sc && isSpanContextValid(sc) ? sc.traceId : undefined;
}

/** W3C `traceparent` of the active span, to carry trace context across the queue. */
export function currentTraceparent(): string | undefined {
  const carrier: Record<string, string> = {};
  propagator.inject(context.active(), carrier, defaultTextMapSetter);
  return carrier.traceparent;
}

/** Run `fn` as a continuation of the trace in `traceparent` (or as-is when there is none). */
export function runWithTraceparent<T>(traceparent: unknown, fn: () => T): T {
  if (typeof traceparent !== "string" || !traceparent) return fn();
  const ctx = propagator.extract(ROOT_CONTEXT, { traceparent }, defaultTextMapGetter);
  return context.with(ctx, fn);
}

// ---------------------------------------------------------------- setup

type SentryModule = {
  init(options: { dsn: string; environment?: string; enableOpenTelemetrySetup?: boolean }): unknown;
  captureException(e: unknown): string;
  flush(timeout?: number): Promise<boolean>;
  close(timeout?: number): Promise<boolean>;
};
/** Kept on globalThis: Next.js may load this module more than once (instrumentation vs route bundles). */
const slot = globalThis as unknown as { __shortloopSentry?: SentryModule };

/**
 * Load Sentry only at runtime, by a specifier bundlers can't follow, so it never ends up in a bundle
 * (or is even loaded) unless SENTRY_DSN is set.
 */
const loadSentry = (name: string) =>
  import(/* webpackIgnore: true */ /* turbopackIgnore: true */ name) as Promise<SentryModule>;

export interface TelemetryOptions {
  serviceName: string;
  /** Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Extra span processors (tests pass an in-memory exporter). */
  spanProcessors?: SpanProcessor[];
}

export interface Telemetry {
  /** What is actually exported: OTLP only when OTEL_EXPORTER_OTLP_ENDPOINT is set, Sentry only when SENTRY_DSN is. */
  exporting: { otlp: boolean; sentry: boolean };
  /** Flush pending spans and errors (use on shutdown). */
  flush(): Promise<void>;
  /** Flush, then unregister the global tracer provider. */
  shutdown(): Promise<void>;
}

/**
 * Register a tracer provider for this process. Spans go to an OTLP/HTTP collector only if
 * OTEL_EXPORTER_OTLP_ENDPOINT (or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) is set; errors go to Sentry only if
 * SENTRY_DSN is set. With neither, spans are kept in-process (trace ids still land in the audit log).
 */
export async function initTelemetry(opts: TelemetryOptions): Promise<Telemetry> {
  const env = opts.env ?? process.env;
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const url = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || (base ? `${base.replace(/\/+$/, "")}/v1/traces` : "");
  const otlp = Boolean(url);
  const processors: SpanProcessor[] = [...(opts.spanProcessors ?? [])];
  // Headers (e.g. an API key) come from OTEL_EXPORTER_OTLP_HEADERS, read by the exporter itself.
  if (otlp) processors.push(new BatchSpanProcessor(new OTLPTraceExporter({ url })));
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: opts.serviceName,
      "deployment.environment.name": env.SHORTLOOP_ENV ?? env.NODE_ENV ?? "development",
    }),
    spanProcessors: processors,
  });
  provider.register();

  const dsn = env.SENTRY_DSN;
  if (dsn) {
    const sentry = await loadSentry("@sentry/node");
    // Keep our own tracer provider: Sentry only reports errors.
    sentry.init({ dsn, environment: env.SHORTLOOP_ENV ?? env.NODE_ENV, enableOpenTelemetrySetup: false });
    slot.__shortloopSentry = sentry;
  }

  const flush = async () => {
    await provider.forceFlush();
    await slot.__shortloopSentry?.flush(2000);
  };
  return {
    exporting: { otlp, sentry: Boolean(dsn) },
    flush,
    async shutdown() {
      await provider.forceFlush();
      await provider.shutdown();
      await slot.__shortloopSentry?.close(2000);
      trace.disable();
      context.disable();
      slot.__shortloopSentry = undefined;
    },
  };
}

/** Report an unexpected error to Sentry (no-op unless SENTRY_DSN was set at `initTelemetry`). */
export function reportError(e: unknown): void {
  slot.__shortloopSentry?.captureException(e);
}
