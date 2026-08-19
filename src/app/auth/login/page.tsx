"use client";

import { Suspense, useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { safeRedirectTarget } from "@/lib/auth/safeRedirect";

type Step = "credentials" | "totp";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = safeRedirectTarget(searchParams.get("redirect"));

  const [step, setStep] = useState<Step>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleCredentialsSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/auth/check-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();

      if (!data.valid) {
        setError(
          response.status === 429
            ? "Too many attempts. Try again later."
            : "Invalid username or password.",
        );
        return;
      }

      if (data.totpRequired) {
        setStep("totp");
        return;
      }

      await completeSignIn({ username, password });
    } finally {
      setPending(false);
    }
  }

  async function handleTotpSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await completeSignIn({ username, password, totpCode });
    } finally {
      setPending(false);
    }
  }

  async function completeSignIn(credentials: { username: string; password: string; totpCode?: string }) {
    const result = await signIn("credentials", { ...credentials, redirect: false });
    if (result?.error) {
      // By this point check-credentials has already confirmed username +
      // password on the totp step, so a failure here is (almost always) a
      // wrong/expired code — say so instead of the credentials-step's
      // generic three-way message, which read as if the password might
      // also be wrong even though this screen no longer asks for it.
      setError(step === "totp" ? "Invalid authenticator code." : "Login failed. Please try again.");
      return;
    }
    router.push(redirectTarget);
    router.refresh();
  }

  if (step === "totp") {
    return (
      <main>
        <h1>Enter your authenticator code</h1>
        <form onSubmit={handleTotpSubmit}>
          <div>
            <label htmlFor="totpCode">6-digit code</label>
            <input
              id="totpCode"
              name="totpCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
            />
          </div>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={pending}>
            {pending ? "Verifying…" : "Verify"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main>
      <h1>Log in</h1>
      <form onSubmit={handleCredentialsSubmit}>
        <div>
          <label htmlFor="username">Username or email</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p>
        <a href="/auth/forgot-password">Forgot your password?</a>
      </p>
      <p>
        Need an account? <a href="/auth/register">Register</a>
      </p>
    </main>
  );
}
