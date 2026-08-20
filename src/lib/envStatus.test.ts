import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnvStatus } from "./envStatus";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllEnvs();
});

function setBaseline() {
  process.env.APP_ENV = "development";
  // NODE_ENV's type declaration is read-only, unlike every other var here —
  // vi.stubEnv sidesteps that at the type level while still mutating the
  // same underlying process.env at runtime.
  vi.stubEnv("NODE_ENV", "test");
  process.env.STRIPE_SECRET_KEY = "sk_live_real";
  process.env.AWS_REGION = "us-east-1";
  process.env.SES_FROM_EMAIL = "noreply@example.test";
  process.env.DATABASE_URL = "postgres://user:pass@db.example.test:5432/app";
}

describe("getEnvStatus — appEnv resolution", () => {
  it("uses APP_ENV when it's a recognized value", () => {
    setBaseline();
    process.env.APP_ENV = "staging";
    expect(getEnvStatus().appEnv).toBe("staging");
  });

  it("falls back to production when APP_ENV is unset and NODE_ENV is production", () => {
    setBaseline();
    delete process.env.APP_ENV;
    vi.stubEnv("NODE_ENV", "production");
    expect(getEnvStatus().appEnv).toBe("production");
  });

  it("falls back to development when APP_ENV is unset and NODE_ENV isn't production", () => {
    setBaseline();
    delete process.env.APP_ENV;
    vi.stubEnv("NODE_ENV", "development");
    expect(getEnvStatus().appEnv).toBe("development");
  });

  it("falls back to NODE_ENV-derived logic when APP_ENV is an unrecognized value", () => {
    setBaseline();
    process.env.APP_ENV = "bogus";
    vi.stubEnv("NODE_ENV", "production");
    expect(getEnvStatus().appEnv).toBe("production");
  });
});

describe("getEnvStatus — Stripe/SES/DB mode detection", () => {
  it("reports Stripe Live only for an sk_live_ key", () => {
    setBaseline();
    process.env.STRIPE_SECRET_KEY = "sk_live_abc";
    expect(getEnvStatus().stripeMode).toBe("Live");
  });

  it("reports Stripe Test for an sk_test_ key or an unset key", () => {
    setBaseline();
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    expect(getEnvStatus().stripeMode).toBe("Test");

    delete process.env.STRIPE_SECRET_KEY;
    expect(getEnvStatus().stripeMode).toBe("Test");
  });

  it("reports SES Live only when both AWS_REGION and SES_FROM_EMAIL are set", () => {
    setBaseline();
    expect(getEnvStatus().sesMode).toBe("Live");

    delete process.env.SES_FROM_EMAIL;
    expect(getEnvStatus().sesMode).toBe("Console fallback");
  });

  it("classifies DATABASE_URL's hostname as Local for localhost/127.0.0.1, Remote otherwise", () => {
    setBaseline();
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/app";
    expect(getEnvStatus().dbTarget).toBe("Local");

    process.env.DATABASE_URL = "postgres://user:pass@127.0.0.1:5432/app";
    expect(getEnvStatus().dbTarget).toBe("Local");

    process.env.DATABASE_URL = "postgres://user:pass@prod-db.internal:5432/app";
    expect(getEnvStatus().dbTarget).toBe("Remote");
  });
});

describe("getEnvStatus — isAnomalous", () => {
  it("is false outside production even with test-mode Stripe and a local DB", () => {
    setBaseline();
    process.env.APP_ENV = "development";
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/app";
    expect(getEnvStatus().isAnomalous).toBe(false);
  });

  it("is false in production when Stripe/SES/DB are all live/remote", () => {
    setBaseline();
    process.env.APP_ENV = "production";
    expect(getEnvStatus().isAnomalous).toBe(false);
  });

  it("is true in production when Stripe is still in test mode", () => {
    setBaseline();
    process.env.APP_ENV = "production";
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    expect(getEnvStatus().isAnomalous).toBe(true);
  });

  it("is true in production when SES falls back to console logging", () => {
    setBaseline();
    process.env.APP_ENV = "production";
    delete process.env.AWS_REGION;
    expect(getEnvStatus().isAnomalous).toBe(true);
  });

  it("is true in production when the DB is still local", () => {
    setBaseline();
    process.env.APP_ENV = "production";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/app";
    expect(getEnvStatus().isAnomalous).toBe(true);
  });
});
