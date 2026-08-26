/**
 * Deliberately its own module with zero imports (not storage.ts, which
 * pulls in @aws-sdk/client-s3) — next.config.ts needs this value too, and
 * a config file importing the AWS SDK just to read a number would be an
 * odd and heavy dependency for it to carry.
 */
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * A technical/security limit (guards against a pathologically large image
 * slowing down every page it's embedded on), not a business value — same
 * "own hardcoded constant" reasoning as MAX_UPLOAD_SIZE_BYTES, not a
 * system_settings row.
 */
export const MAX_IMAGE_DIMENSION_PX = 6000;
