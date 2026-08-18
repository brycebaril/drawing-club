import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Server Actions default to a 1MB request body limit — far under
    // src/app/ops/cms/uploads/actions.ts's own 10MB cap, so an upload
    // between 1MB and 10MB would otherwise hit a framework-level rejection
    // (a generic "server error" page) before that action's own validation
    // ever ran. 12mb leaves room for multipart/form-data's boundary and
    // field-metadata overhead on top of a 10MB file, per Next's own docs.
    serverActions: {
      bodySizeLimit: "12mb",
    },
    // A *second*, separate 10MB default (independent of serverActions
    // above) governs how much of the request body src/proxy.ts (Next 16's
    // renamed Middleware, which runs on every non-/api/* route including
    // /ops/cms/uploads) is allowed to see. Left at its default, an 11MB
    // upload gets silently truncated to 10MB before it ever reaches the
    // Server Action's own multipart parser — the parser then chokes on the
    // cut-off body ("Unexpected end of form") and crashes with a generic
    // digest-only error page, not this action's own "too large" message.
    // Found by reproducing directly against a `pnpm build && pnpm start`
    // and reading the server's own console output, since the client only
    // ever sees the opaque digest. middlewareClientMaxBodySize is this
    // same setting's deprecated pre-v16 name — proxyClientMaxBodySize is
    // current.
    proxyClientMaxBodySize: "12mb",
  },
};

export default nextConfig;
