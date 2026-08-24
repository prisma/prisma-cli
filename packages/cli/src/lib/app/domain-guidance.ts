type DomainFailureCategory = "dns" | "acme" | "storage" | "unknown" | null;

interface DomainDnsRecord {
  type: string;
  name: string;
  value: string;
}

interface DomainFailureGuidanceInput {
  hostname: string;
  status: string;
  failureCategory: DomainFailureCategory;
  dnsRecords: DomainDnsRecord[];
}

export function formatDomainFailureFix(
  domain: DomainFailureGuidanceInput,
): string | null {
  if (domain.status !== "failed") {
    return null;
  }

  const dnsRecord = domain.dnsRecords[0];

  if (domain.failureCategory === "dns") {
    if (dnsRecord) {
      return `Add ${dnsRecord.type} ${dnsRecord.name} -> ${dnsRecord.value}, then run prisma service domain retry ${domain.hostname}.`;
    }

    return `DNS verification failed, but the platform did not return a DNS record. Run prisma service domain show ${domain.hostname} later, then retry when the DNS target is available.`;
  }

  if (domain.failureCategory === "acme") {
    return `Retry TLS issuance with prisma service domain retry ${domain.hostname}. Contact support if it fails again.`;
  }

  if (domain.failureCategory === "storage") {
    return `Retry provisioning with prisma service domain retry ${domain.hostname}. Contact support if it fails again.`;
  }

  return `Run prisma service domain retry ${domain.hostname}. Contact support if it fails again.`;
}
