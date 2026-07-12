import type { CollectorResult } from "@/collectors/types";
import type {
  HealthableSourceName,
  SourceFailureCategory,
  SourceHealthStatus,
} from "@/lib/sources/types";
import { sanitizeDiagnosticMessage } from "@/lib/sources/sanitize";

export type ClassifiedHealth = {
  status: SourceHealthStatus;
  failureCategory?: SourceFailureCategory;
  safeMessage?: string;
  leadsFound: number;
  accepted: number;
};

function joinMessages(result: CollectorResult): string {
  return [...result.errors, ...result.warnings].join(" | ");
}

export function classifyFailureText(text: string): SourceFailureCategory | undefined {
  const lower = text.toLowerCase();

  if (
    /missing.?api.?key|not configured|search_provider|search_api_key|unconfigured/i.test(
      lower,
    )
  ) {
    return "missing_api_key";
  }
  if (/rate.?limit|too many requests|429/.test(lower)) return "rate_limit";
  if (
    /cloudflare|captcha|access denied|blocked|anti-?bot|bot detection|403 forbidden/.test(
      lower,
    )
  ) {
    return "anti_bot";
  }
  if (
    /enotfound|econnrefused|econnreset|etimedout|network|fetch failed|socket|dns|getaddrinfo/.test(
      lower,
    )
  ) {
    return "network";
  }
  if (/playwright|browser.*not installed|executable doesn't exist/.test(lower)) {
    return "browser_missing";
  }
  if (/profile.?missing|no browser profile|profile directory/.test(lower)) {
    return "profile_missing";
  }
  if (
    /login|sign in|credentials|auth(?:entication)? required|session expired|reconnect/.test(
      lower,
    )
  ) {
    if (/expired|reconnect/.test(lower)) return "session_expired";
    return "auth_required";
  }
  if (
    /selector|parser|parse failed|ui may have changed|no visible cards|markup|dom/.test(
      lower,
    )
  ) {
    return "selector_parser_failure";
  }
  if (/no current|no upcoming|ended|no events/.test(lower)) {
    return "no_current_events";
  }
  if (/no promising|zero|no .*results|returned no/.test(lower)) {
    return "zero_matching_results";
  }
  return undefined;
}

/**
 * Map a collector diagnostic run into a health status.
 * Zero leads is NOT blindly healthy — requires contextual classification.
 */
export function classifyCollectorResult(
  source: HealthableSourceName,
  result: CollectorResult,
  options: {
    authenticated?: boolean;
    preCategory?: SourceFailureCategory;
    preStatus?: SourceHealthStatus;
    preMessage?: string;
  } = {},
): ClassifiedHealth {
  const leadsFound = result.leads.length;
  const accepted = leadsFound;
  const joined = joinMessages(result);
  const safeJoined = joined ? sanitizeDiagnosticMessage(joined) : undefined;

  if (options.preStatus) {
    return {
      status: options.preStatus,
      failureCategory: options.preCategory,
      safeMessage: options.preMessage
        ? sanitizeDiagnosticMessage(options.preMessage)
        : safeJoined,
      leadsFound,
      accepted,
    };
  }

  if (result.errors.length > 0) {
    const category = classifyFailureText(joined) ?? "unknown";
    const status: SourceHealthStatus =
      category === "auth_required" || category === "session_expired"
        ? "auth_required"
        : category === "missing_api_key" || category === "profile_missing"
          ? "unconfigured"
          : category === "rate_limit" || category === "anti_bot"
            ? "degraded"
            : "failed";

    return {
      status,
      failureCategory: category,
      safeMessage: safeJoined ?? "Collector reported an error.",
      leadsFound,
      accepted,
    };
  }

  // Auth-required via warnings (Hakku login page, etc.)
  if (
    /login|sign in|authentication required|auth_required|credentials/i.test(joined) &&
    (source === "hakku" || options.authenticated === false)
  ) {
    const category = /expired|reconnect/i.test(joined)
      ? ("session_expired" as const)
      : ("auth_required" as const);
    return {
      status: "auth_required",
      failureCategory: category,
      safeMessage: safeJoined ?? "Authentication required.",
      leadsFound,
      accepted,
    };
  }

  if (leadsFound > 0) {
    const degraded =
      result.warnings.length > 0 &&
      /selector|parser|ui may have changed|timeout|partial/i.test(joined);
    return {
      status: degraded ? "degraded" : "healthy",
      failureCategory: degraded ? classifyFailureText(joined) : undefined,
      safeMessage: degraded ? safeJoined : undefined,
      leadsFound,
      accepted,
    };
  }

  // Zero leads — classify carefully
  if (!joined) {
    return {
      status: "degraded",
      failureCategory: "zero_matching_results",
      safeMessage: "Diagnostic completed with zero matching results.",
      leadsFound: 0,
      accepted: 0,
    };
  }

  const category = classifyFailureText(joined) ?? "zero_matching_results";

  if (category === "auth_required" || category === "session_expired") {
    return {
      status: "auth_required",
      failureCategory: category,
      safeMessage: safeJoined,
      leadsFound: 0,
      accepted: 0,
    };
  }

  if (category === "missing_api_key" || category === "profile_missing") {
    return {
      status: "unconfigured",
      failureCategory: category,
      safeMessage: safeJoined,
      leadsFound: 0,
      accepted: 0,
    };
  }

  if (category === "selector_parser_failure") {
    return {
      status: "degraded",
      failureCategory: category,
      safeMessage: safeJoined,
      leadsFound: 0,
      accepted: 0,
    };
  }

  if (category === "no_current_events" || category === "zero_matching_results") {
    return {
      status: "degraded",
      failureCategory: category,
      safeMessage: safeJoined,
      leadsFound: 0,
      accepted: 0,
    };
  }

  return {
    status: "degraded",
    failureCategory: category,
    safeMessage: safeJoined,
    leadsFound: 0,
    accepted: 0,
  };
}
