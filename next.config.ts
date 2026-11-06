import { execSync } from "node:child_process";
import type { NextConfig } from "next";
// Relative import, not the "@/" alias — next.config.ts is loaded directly
// by Next's CLI, outside the normal app module graph, and isn't guaranteed
// to resolve tsconfig path aliases the way route code does.
import { MAX_UPLOAD_SIZE_BYTES } from "./src/lib/uploads/constants";

// Headroom above the app-level cap for multipart/form-data's own boundary
// and field-metadata overhead, per Next's docs on serverActions.bodySizeLimit.
const REQUEST_BODY_SIZE_LIMIT = MAX_UPLOAD_SIZE_BYTES + 2 * 1024 * 1024;

// src/lib/envStatus.ts's build-info source. Prefers Amplify's own
// build-provided commit id (AWS_COMMIT_ID — set on every Amplify Hosting
// build, confirmed against AWS's own environment-variables reference) over
// running git ourselves: Amplify's CodeBuild environment showed "build
// unknown" on staging even though `git rev-parse` works fine locally,
// most likely the well-known "detected dubious ownership in repository"
// safety check newer git versions apply when the checkout's owning UID
// differs from the build user's — AWS_COMMIT_ID sidesteps needing git to
// work in the build container at all. AWS_COMMIT_ID is literally the
// string "HEAD" on a rebuild of an already-deployed commit (not a real
// SHA), so that specific value falls through to the git-based derivation
// instead of being trusted as-is. Sliced to 7 chars either way, matching
// `git rev-parse --short`'s own convention, regardless of whichever source
// provided the full-length id. Wrapped in try/catch since a stripped
// deploy artifact without .git shouldn't fail the build over a
// status-banner nicety.
if (!process.env.GIT_SHA) {
  const amplifyCommitId = process.env.AWS_COMMIT_ID;
  if (amplifyCommitId && amplifyCommitId !== "HEAD") {
    process.env.GIT_SHA = amplifyCommitId.slice(0, 7);
  } else {
    try {
      process.env.GIT_SHA = execSync("git rev-parse --short HEAD").toString().trim();
    } catch {
      process.env.GIT_SHA = "unknown";
    }
  }
}

const nextConfig: NextConfig = {
  // Amplify Hosting's SSR compute bundling tries to replicate pnpm's
  // symlinked node_modules/.pnpm virtual-store structure into the Lambda
  // deployment package and fails ("ln: ... Read-only file system", then
  // "Cannot find module .../@swc/helpers/..." at runtime). `standalone`
  // sidesteps this: Next's own output-file-tracer copies (not symlinks)
  // only the files each route actually needs into .next/standalone, which
  // Amplify can package directly without touching pnpm's store layout.
  output: "standalone",
  experimental: {
    // Server Actions default to a 1MB request body limit — far under
    // MAX_UPLOAD_SIZE_BYTES (src/app/ops/cms/uploads/actions.ts's own cap),
    // so an upload between 1MB and that cap would otherwise hit a
    // framework-level rejection (a generic "server error" page) before
    // that action's own validation ever ran.
    serverActions: {
      bodySizeLimit: REQUEST_BODY_SIZE_LIMIT,
    },
    // A *second*, separate 10MB default (independent of serverActions
    // above) governs how much of the request body src/proxy.ts (Next 16's
    // renamed Middleware, which runs on every non-/api/* route including
    // /ops/cms/uploads) is allowed to see. Left at its default, an upload
    // near MAX_UPLOAD_SIZE_BYTES gets silently truncated before it ever
    // reaches the Server Action's own multipart parser — the parser then
    // chokes on the cut-off body ("Unexpected end of form") and crashes
    // with a generic digest-only error page, not this action's own "too
    // large" message. Found by reproducing directly against a
    // `pnpm build && pnpm start` and reading the server's own console
    // output, since the client only ever sees the opaque digest.
    // middlewareClientMaxBodySize is this same setting's deprecated
    // pre-v16 name — proxyClientMaxBodySize is current.
    proxyClientMaxBodySize: REQUEST_BODY_SIZE_LIMIT,
  },
};

export default nextConfig;
