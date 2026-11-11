import { afterEach, describe, expect, it, vi } from "vitest";
import { requireApiKeyScope } from "./apiKey";

const DEV_KEY = "dev-stats-api-key-do-not-use-in-production";

function bearer(key: string): Request {
  return new Request("http://localhost/api/stats/users", { headers: { authorization: `Bearer ${key}` } });
}

describe("requireApiKeyScope and the committed dev key", () => {
  afterEach(() => vi.unstubAllEnvs());

  // Its raw value is public and a migration seeds it into every database.
  it.each(["staging", "production"])("rejects it when APP_ENV is %s", async (appEnv) => {
    vi.stubEnv("APP_ENV", appEnv);
    expect(await requireApiKeyScope(bearer(DEV_KEY), "users")).toEqual({
      ok: false,
      status: 401,
      error: "Invalid or revoked API key.",
    });
  });

  it("still accepts it in local development", async () => {
    vi.stubEnv("APP_ENV", "development");
    expect((await requireApiKeyScope(bearer(DEV_KEY), "users")).ok).toBe(true);
  });
});
