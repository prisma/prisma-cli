import type { DomainRecord } from "./app-provider";

type DomainGuidanceInput = { serviceId: string | null } & Pick<
  DomainRecord,
  | "hostname"
  | "state"
  | "dnsRecords"
  | "failureReason"
  | "syncError"
  | "dnsDetail"
  | "heldBy"
>;

export interface DomainStateGuidance {
  /** What the hostname still needs, or what the platform is doing. */
  waitingOn: string;
  /** What the user has to do. Null when nobody has to act. */
  fix: string | null;
}

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
      waitingOn:
        "This service lists the hostname more than once, and another entry holds it.",
      fix: null,
    };
  }
  return {
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
        waitingOn: "Proof in DNS that this workspace owns the domain.",
        fix: `Publish ${records} at your DNS provider, then run ${retry}. ${apexNote} If the state stays not_verified long after the records are published, the workspace may have no domain ownership for this hostname: deleting the hostname and adding it again creates one.`,
      };
    case "no_service":
      return {
        waitingOn: "The service this hostname routed to was deleted.",
        fix: "Delete the hostname, then add it to the service that should serve it.",
      };
    case "no_live_deployment":
      return {
        waitingOn: "The service has no live version.",
        fix: `Deploy the service or promote one of its versions.${routingRecords ? ` Also publish ${routingRecords}. ${apexNote}` : ""}`,
      };
    case "update_failed":
      return {
        waitingOn: `${withDetail("The platform could not bring the hostname up to date", domain.syncError)} It tries again on its own.`,
        fix: null,
      };
    case "in_use_elsewhere":
      return inUseElsewhereGuidance(domain);
    case "waiting_for_dns":
      return {
        waitingOn: withDetail(
          "The hostname's DNS does not point at Prisma",
          domain.dnsDetail,
        ),
        fix: routingRecords
          ? `Publish ${routingRecords} at your DNS provider, then run ${retry}. ${apexNote}`
          : `Point the hostname at Prisma, then run ${retry}.`,
      };
    case "provisioning_certificate":
      return {
        waitingOn: "The TLS certificate is being issued.",
        fix: null,
      };
    case "certificate_failed":
      return {
        waitingOn: withDetail(
          "The TLS certificate could not be issued",
          domain.failureReason,
        ),
        fix: `Fix what made it fail, then run ${retry}.`,
      };
    case "updating":
      return {
        waitingOn: "The platform is bringing the hostname up to date.",
        fix: null,
      };
  }
}
