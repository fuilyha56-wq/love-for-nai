// A multi-step job must outlive one upstream response, and the client must keep
// polling until after the server deadline rather than abandoning it at 60 polls.
export const ASSISTANT_MODEL_TIMEOUT_MS = 125_000;
export const ASSISTANT_JOB_TIMEOUT_MS = 6 * 60_000;
export const ASSISTANT_CLIENT_TIMEOUT_MS = ASSISTANT_JOB_TIMEOUT_MS + 30_000;
export const ASSISTANT_POLL_INTERVAL_MS = 2_000;
export const ASSISTANT_MAX_POLLS = Math.ceil(ASSISTANT_CLIENT_TIMEOUT_MS / ASSISTANT_POLL_INTERVAL_MS);
