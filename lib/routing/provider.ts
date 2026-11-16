import type { PlanRequest, PlanResult } from "./types";

/**
 * Every routing backend implements this. UI and route handlers depend only on
 * this interface (CLAUDE.md rule 7), never on a provider's HTTP API.
 */
export interface RoutingProvider {
  readonly name: string;
  plan(request: PlanRequest): Promise<PlanResult>;
}

/** The provider's quota or rate limit is used up. Show "busy, try again". */
export class ProviderQuotaError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "ProviderQuotaError";
  }
}

/** The provider failed or returned something we cannot trust. */
export class ProviderUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderUnavailableError";
  }
}
