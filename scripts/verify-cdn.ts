import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { docsAssets, docsAssetUrl } from "../packages/api/src/docs-assets.js";

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const metadata = JSON.parse(
  (await download(`https://registry.npmjs.org/swagger-ui-dist/${docsAssets.version}`)).toString()
) as { dist: { tarball: string; integrity: string } };
const archive = await download(metadata.dist.tarball);
const archiveIntegrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
if (archiveIntegrity !== metadata.dist.integrity) throw new Error("npm archive integrity mismatch");
for (const asset of [docsAssets.css, docsAssets.js]) {
  const packaged = execFileSync("tar", ["-xzOf", "-", `package/${asset.file}`], {
    input: archive,
    maxBuffer: 8 * 1024 * 1024,
  });
  const expected = `sha384-${createHash("sha384").update(packaged).digest("base64")}`;
  if (expected !== asset.integrity)
    throw new Error(`${asset.file}: committed SRI differs from npm package (${expected})`);
  const cdn = await download(docsAssetUrl(asset.file));
  if (!cdn.equals(packaged)) throw new Error(`${asset.file}: CDN differs from npm package`);
  console.log(`${asset.file}: pinned package, CDN bytes, and SRI match`);
}
