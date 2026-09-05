export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_UPSTREAM = "https://studio.genlayer.com/api";
const FRESH_MS = 30_000;
const STALE_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 100_000;
const MAX_CACHE_ENTRIES = 250;

interface RpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: unknown;
  params?: unknown[];
}

interface RpcPayload {
  jsonrpc: "2.0";
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

interface CacheEntry {
  payload: Omit<RpcPayload, "id">;
  storedAt: number;
}

const readCache = new Map<string, CacheEntry>();

function upstreamUrl(): string {
  const configured =
    process.env.GENLAYER_RPC_URL?.trim() || process.env.NEXT_PUBLIC_GENLAYER_RPC?.trim();
  return configured && /^https?:\/\//i.test(configured) ? configured : DEFAULT_UPSTREAM;
}

function isAllowedMethod(method: string): boolean {
  return /^(gen_|eth_|zks_)/.test(method) || method === "sim_cancelTransaction";
}

function isCacheableRead(request: RpcRequest): boolean {
  if (request.method !== "gen_call") return false;
  const call = request.params?.[0];
  return Boolean(call && typeof call === "object" && (call as { type?: unknown }).type === "read");
}

function cacheKey(request: RpcRequest): string {
  return JSON.stringify({ method: request.method, params: request.params ?? [] });
}

function reply(payload: Omit<RpcPayload, "id">, id: unknown, cacheState = "miss") {
  return Response.json(
    { ...payload, jsonrpc: "2.0", id: id ?? null },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-GenLayer-Relay-Cache": cacheState,
      },
    },
  );
}

function remember(key: string, payload: Omit<RpcPayload, "id">) {
  if (readCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = readCache.keys().next().value;
    if (oldest) readCache.delete(oldest);
  }
  readCache.set(key, { payload, storedAt: Date.now() });
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return Response.json({ error: "RPC request is too large." }, { status: 413 });
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return Response.json({ error: "RPC request is too large." }, { status: 413 });
  }

  let rpc: RpcRequest;
  try {
    rpc = JSON.parse(raw) as RpcRequest;
  } catch {
    return Response.json({ error: "Invalid JSON-RPC request." }, { status: 400 });
  }

  const method = typeof rpc.method === "string" ? rpc.method : "";
  if (!method || !isAllowedMethod(method)) {
    return reply(
      { jsonrpc: "2.0", error: { code: -32601, message: "RPC method is not allowed." } },
      rpc.id,
    );
  }

  const cacheable = isCacheableRead(rpc);
  const key = cacheable ? cacheKey(rpc) : "";
  const cached = cacheable ? readCache.get(key) : undefined;
  const age = cached ? Date.now() - cached.storedAt : Number.POSITIVE_INFINITY;
  if (cached && age <= FRESH_MS) return reply(cached.payload, rpc.id, "fresh");

  try {
    const upstream = await fetch(upstreamUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpc.id ?? Date.now(),
        method,
        params: Array.isArray(rpc.params) ? rpc.params : [],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await upstream.json()) as RpcPayload;

    if (upstream.ok && payload.result !== undefined && cacheable) {
      const stored = { jsonrpc: "2.0" as const, result: payload.result };
      remember(key, stored);
      return reply(stored, rpc.id, "miss");
    }
    if ((!upstream.ok || payload.error) && cached && age <= STALE_MS) {
      return reply(cached.payload, rpc.id, "stale");
    }
    if (upstream.status === 429) {
      return reply(
        {
          jsonrpc: "2.0",
          error: {
            code: -32029,
            message: "StudioNet RPC is temporarily rate-limited. Please retry shortly.",
            data: { retryAfter: upstream.headers.get("retry-after") },
          },
        },
        rpc.id,
      );
    }
    return reply(
      payload.error !== undefined
        ? { jsonrpc: "2.0", error: payload.error }
        : { jsonrpc: "2.0", result: payload.result },
      rpc.id,
    );
  } catch (error) {
    if (cached && age <= STALE_MS) return reply(cached.payload, rpc.id, "stale");
    const message = error instanceof Error ? error.message : "StudioNet RPC request failed.";
    return reply(
      { jsonrpc: "2.0", error: { code: -32000, message } },
      rpc.id,
    );
  }
}
