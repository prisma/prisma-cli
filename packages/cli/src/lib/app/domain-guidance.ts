import type { DomainRecord } from "./app-provider";

type DomainGuidanceInput = { serviceId: string | null } & Pick<
  DomainRecord,
  "hostname" | "state" | "dnsRecords" | "failureReason" | "dnsDetail" | "heldBy"
>;

export interface DomainStateGuidance {
  /** Whether `waitingOn` reports a failure, not something still awaited. */
  failed: boolean;
  /** What the hostname still needs, what the platform is doing, or what failed. */
  waitingOn: string;
  /** What the user has to do. Null when nobody has to act. */
  fix: string | null;
}

/**
 * For a failure the platform gave us nothing about that a user can act
 * on. See "Errors from the systems below the API" in
 * docs/product/error-conventions.md.
 */
export const UNEXPLAINED_FAILURE =
  "Provisioning failed for reasons we are not sure about. You can try again, or contact support.";

const ENDS_A_SENTENCE = /[.!?]$/;

function formatRecords(records: DomainGuidanceInput["dnsRecords"]): string {
  return records
    .map((record) => `${record.type} ${record.name} -> ${record.value}`)
    .join(" and ");
}

function withDetail(sentence: string, detail: string | null): string {
  if (!detail) {
    return `${sentence}.`;
  }
  return `${sentence}: ${detail}${ENDS_A_SENTENCE.test(detail) ? "" : "."}`;
}

function inUseElsewhereGuidance(
  domain: DomainGuidanceInput,
): DomainStateGuidance {
  const holder = domain.heldBy?.serviceId ?? null;
  if (holder !== null && holder === domain.serviceId) {
    return {
      failed: false,
      waitingOn:
        "This service lists the hostname more than once, and another entry holds it.",
      fix: null,
    };
  }
  return {
    failed: false,
    waitingOn: `${withDetail(
      "Another service holds this hostname",
      holder ? `service ${holder}` : (domain.heldBy?.message ?? null),
    )} This service takes it over once that one gives it up.`,
    fix: holder ? `Delete the hostname from service ${holder}.` : null,
  };
}

/** While the hostname waits for records the user publishes, only a check
 *  makes the platform look DNS up again. */
export function waitsForUserDns(domain: Pick<DomainRecord, "state">): boolean {
  return domain.state === "not_verified" || domain.state === "waiting_for_dns";
}

/**
 * States a wait stops at. A failed certificate is only retried when the
 * user asks, and a hostname whose service is deleted has to be added
 * again. In the other states where the user has to act, such as
 * publishing DNS or deploying, the hostname goes on by itself once they
 * have, so a wait keeps going.
 */
export function cannotBecomeActive(
  domain: Pick<DomainRecord, "state">,
): boolean {
  return domain.state === "certificate_failed" || domain.state === "no_service";
}

/** What a hostname that is not serving yet waits on. Null once it serves. */
export function domainStateGuidance(
  domain: DomainGuidanceInput,
  /** The full `service domain retry` command for this hostname's service. */
  retry: string,
): DomainStateGuidance | null {
  const records = formatRecords(domain.dnsRecords);
  const routingRecords = formatRecords(
    domain.dnsRecords.filter((record) => record.type === "CNAME"),
  );
  const apexNote =
    "At an apex domain, publish the CNAME as an ALIAS, ANAME or flattened CNAME with the same target.";

  switch (domain.state) {
    case "active":
      return null;
    case "not_verified":
      return {
        failed: false,
        waitingOn: "Proof in DNS that this workspace owns the domain.",
        fix: `Publish ${records} at your DNS provider, then run ${retry}. ${apexNote}`,
      };
    case "no_service":
      return {
        failed: false,
        waitingOn: "The service this hostname routed to was deleted.",
        fix: "Delete the hostname, then add it to the service that should serve it.",
      };
    case "no_live_deployment":
      return {
        failed: false,
        waitingOn: "The service has no live version.",
        fix: `Deploy the service or promote one of its versions.${routingRecords ? ` Also publish ${routingRecords}. ${apexNote}` : ""}`,
      };
    case "update_failed":
      return {
        failed: true,
        waitingOn:
          "Updating the hostname failed for reasons we are not sure about. You can try again, or contact support.",
        fix: null,
      };
    case "in_use_elsewhere":
      return inUseElsewhereGuidance(domain);
    case "waiting_for_dns":
      return {
        failed: false,
        waitingOn: domain.dnsDetail
          ? `The hostname's DNS does not point at Prisma. The platform reported: ${domain.dnsDetail}`
          : "The hostname's DNS does not point at Prisma.",
        fix: routingRecords
          ? `Publish ${routingRecords} at your DNS provider, then run ${retry}. ${apexNote}`
          : `Point the hostname at Prisma, then run ${retry}.`,
      };
    case "provisioning_certificate":
      return {
        failed: false,
        waitingOn: "The TLS certificate is being issued.",
        fix: null,
      };
    case "certificate_failed":
      return {
        failed: true,
        waitingOn: domain.failureReason
          ? `Provisioning failed. The platform reported: ${domain.failureReason}`
          : UNEXPLAINED_FAILURE,
        fix: null,
      };
    case "updating":
      return {
        failed: false,
        waitingOn: "The platform is bringing the hostname up to date.",
        fix: null,
      };
  }
}

/** States in which the platform, not the user, has to act next. */
export function waitsForPlatform(domain: Pick<DomainRecord, "state">): boolean {
  return (
    domain.state === "provisioning_certificate" ||
    domain.state === "updating" ||
    domain.state === "update_failed"
  );
}
