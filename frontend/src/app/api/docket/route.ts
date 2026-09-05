import { readCase, readCaseIds } from "@/lib/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
  "Content-Type": "application/json; charset=utf-8",
};
const STALE_DOCKET_MS = 24 * 60 * 60 * 1000;

let lastDocket: { cases: unknown[]; storedAt: number } | undefined;

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return String(error ?? "");
}

export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  try {
    const ids = await readCaseIds();
    const settled = await Promise.allSettled(ids.map((caseId) => readCase(caseId)));
    const cases = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failures = settled.length - cases.length;

    if (ids.length > 0 && cases.length === 0) {
      const firstFailure = settled.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      throw firstFailure?.reason ?? new Error("No case records could be read.");
    }

    lastDocket = { cases, storedAt: Date.now() };

    return new Response(serialize({ cases, caseCount: cases.length, failures }), {
      status: 200,
      headers: fresh ? { "Cache-Control": "no-store", "Content-Type": CACHE_HEADERS["Content-Type"] } : CACHE_HEADERS,
    });
  } catch (error) {
    console.error("Docket read failed:", errorText(error));
    if (lastDocket && Date.now() - lastDocket.storedAt <= STALE_DOCKET_MS) {
      return new Response(
        serialize({
          cases: lastDocket.cases,
          caseCount: lastDocket.cases.length,
          failures: 0,
          stale: true,
        }),
        { status: 200, headers: fresh ? { ...CACHE_HEADERS, "Cache-Control": "no-store" } : CACHE_HEADERS },
      );
    }
    return Response.json(
      {
        error:
          "StudioNet is temporarily rate-limiting live reads. Please retry in a moment; the contract and recorded proof remain available from the repository.",
      },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
    );
  }
}
