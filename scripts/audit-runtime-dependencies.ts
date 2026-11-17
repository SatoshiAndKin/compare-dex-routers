import { readFileSync } from "node:fs";

interface Advisory {
  github_advisory_id: string | null;
  module_name: string;
  severity: string;
  findings: { version: string }[];
}

interface AuditReport {
  advisories: Record<string, Advisory>;
  metadata: { vulnerabilities: { high: number; critical: number } };
}

export function classifyAudit(report: AuditReport, runtime: Set<string>) {
  const advisories = Object.values(report.advisories);
  const high = advisories.filter((advisory) => advisory.severity === "high");
  const critical = advisories.filter((advisory) => advisory.severity === "critical");
  const counts = report.metadata.vulnerabilities;
  if (high.length !== counts.high || critical.length !== counts.critical) {
    throw new Error("Dependency audit report has incomplete high or critical findings");
  }

  return [...high, ...critical].map((advisory) => {
    const versions = [...new Set(advisory.findings.map(({ version }) => version))];
    if (
      typeof advisory.module_name !== "string" ||
      !advisory.module_name ||
      !versions.length ||
      versions.some((version) => typeof version !== "string" || !version)
    ) {
      throw new Error("Dependency audit finding has no package name or version");
    }

    const packages = versions.map((version) => `${advisory.module_name}@${version}`);
    const unknownVersionShips = runtime.has(`${advisory.module_name}@*`);
    return {
      id: advisory.github_advisory_id ?? advisory.module_name,
      severity: advisory.severity,
      shipped: packages.filter((entry) => unknownVersionShips || runtime.has(entry)),
      unshipped: packages.filter((entry) => !unknownVersionShips && !runtime.has(entry)),
    };
  });
}

function readInventory(path: string): string[] {
  const packages: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !Array.isArray(packages) ||
    !packages.length ||
    packages.some((p) => typeof p !== "string" || p.lastIndexOf("@") < 1 || p.endsWith("@"))
  ) {
    throw new Error(`Invalid dependency inventory ${path}`);
  }
  return packages;
}

function annotation(level: "error" | "warning", message: string) {
  const escaped = message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  console.log(`::${level} title=Dependency audit::${escaped}`);
}

if (import.meta.main) {
  const [auditPath, apiPath, browserPath] = process.argv.slice(2);
  const runtime = new Set([...readInventory(apiPath), ...readInventory(browserPath)]);
  const findings = classifyAudit(JSON.parse(readFileSync(auditPath, "utf8")), runtime);
  for (const { id, severity, shipped, unshipped } of findings) {
    if (shipped.length) {
      annotation(
        "error",
        `${id} (${severity}) affects shipped dependencies: ${shipped.join(", ")}`
      );
      process.exitCode = 1;
    }
    if (unshipped.length) {
      annotation(
        "warning",
        `${id} (${severity}) affects dependencies outside the application: ${unshipped.join(", ")}`
      );
    }
  }
}
