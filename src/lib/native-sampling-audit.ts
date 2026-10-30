const samplingFields = ["sampler", "noise_schedule", "seed", "scale", "cfg_rescale"] as const;
type SamplingField = typeof samplingFields[number];

export type NativeSamplingAudit = Record<SamplingField, string | number | null> & {
  sampling_provided: Record<SamplingField, boolean>;
  sampling_redacted: SamplingField[];
};

const samplers = new Set([
  "k_euler", "k_euler_ancestral", "k_dpmpp_2s_ancestral", "k_dpmpp_2m",
  "k_dpmpp_2m_sde", "k_dpmpp_sde", "ddim", "ddim_v3", "plms",
]);
const schedules = new Set(["native", "karras", "exponential", "polyexponential"]);

/** Record client-supplied native fields, without defaults or request mutation. */
export function nativeSamplingAudit(body: Record<string, unknown>): NativeSamplingAudit {
  const parameters = body.parameters && typeof body.parameters === "object" && !Array.isArray(body.parameters)
    ? body.parameters as Record<string, unknown> : {};
  const result: NativeSamplingAudit = {
    sampler: null, noise_schedule: null, seed: null, scale: null, cfg_rescale: null,
    sampling_provided: { sampler: false, noise_schedule: false, seed: false, scale: false, cfg_rescale: false },
    sampling_redacted: [],
  };
  for (const field of samplingFields) {
    if (!Object.hasOwn(parameters, field)) continue;
    result.sampling_provided[field] = true;
    const value = parameters[field];
    if (value === null) continue;
    // Unknown strings may contain prompts, credentials or image bytes. This is
    // only an audit allowlist: the original upstream payload is never changed.
    const allowed = field === "sampler" ? typeof value === "string" && samplers.has(value)
      : field === "noise_schedule" ? typeof value === "string" && schedules.has(value)
        : typeof value === "number" && Number.isFinite(value);
    if (allowed) result[field] = value as string | number;
    else result.sampling_redacted.push(field);
  }
  return result;
}
