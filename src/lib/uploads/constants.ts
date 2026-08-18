/**
 * Deliberately its own module with zero imports (not storage.ts, which
 * pulls in @aws-sdk/client-s3) — next.config.ts needs this value too, and
 * a config file importing the AWS SDK just to read a number would be an
 * odd and heavy dependency for it to carry.
 */
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
