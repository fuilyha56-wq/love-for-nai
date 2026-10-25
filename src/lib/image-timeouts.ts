/**
 * Image generation can take more than three minutes on the upstream provider.
 * Keep the app-side deadline below the edge proxy's 450 second response limit.
 */
export const IMAGE_UPSTREAM_TIMEOUT_MS = 420_000;
