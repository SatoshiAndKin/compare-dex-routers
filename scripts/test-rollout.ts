import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const compose = [
  "--project-name",
  "cdr-rollout-test",
  "--env-file",
  "/dev/null",
  "-f",
  "e2e/compose.rollout.yml",
];
const docker = (args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const ids = () => docker(["compose", ...compose, "ps", "-q", "api", "frontend"]).split("\n");
const old = ids();
assert.equal(old.length, 2, "Start the isolated Compose fixture first");
const failures: string[] = [];
let requests = 0;
let running = true;
async function probe() {
  while (running) {
    await Promise.all(
      ["/", "/api/config"].map(async (path) => {
        try {
          const response = await fetch(`http://localhost:5190${path}`, {
            signal: AbortSignal.timeout(3_000),
          });
          await response.arrayBuffer();
          requests++;
          if (response.status !== 200) failures.push(`${path}: HTTP ${response.status}`);
        } catch (error) {
          failures.push(`${path}: ${String(error)}`);
        }
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function rollout(service: string) {
  const child = spawn("docker", ["rollout", ...compose, "--timeout", "120", service], {
    stdio: "inherit",
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  assert.equal(code, 0, `${service} rollout failed`);
}
for (const path of ["/", "/api/config"]) {
  const response = await fetch(`http://localhost:5190${path}`);
  assert.equal(response.status, 200, `Fixture is not ready: ${path}`);
  await response.arrayBuffer();
}
const probing = probe();
try {
  await Promise.all([rollout("api"), rollout("frontend")]);
} finally {
  running = false;
  await probing;
}
const current = ids();
assert.equal(current.length, 2);
assert(
  current.every((id) => !old.includes(id)),
  "Both old containers must be replaced"
);
const containers = JSON.parse(docker(["inspect", ...current])) as {
  Config: { Image: string; StopSignal?: string };
  HostConfig: { NanoCpus: number };
  State: { Health: { Status: string } };
  RestartCount: number;
}[];
for (const container of containers) {
  const api = container.Config.Image.includes("-api:");
  assert.equal(container.HostConfig.NanoCpus, api ? 2_000_000_000 : 500_000_000);
  assert.equal(container.State.Health.Status, "healthy");
  assert.equal(container.RestartCount, 0);
  if (!api) assert.equal(container.Config.StopSignal, "SIGQUIT");
}
assert.equal(
  failures.length,
  0,
  `${failures.length} failed requests during rollout: ${failures.slice(0, 5).join(", ")}`
);
console.log(
  JSON.stringify({
    requests,
    failures: failures.length,
    replaced: current.length,
    cpuLimits: [2, 0.5],
    healthy: true,
  })
);
