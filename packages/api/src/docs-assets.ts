/** Update URLs and hashes together with scripts/verify-cdn.ts. */
export const docsAssets = {
  version: "5.32.15",
  css: {
    file: "swagger-ui.css",
    integrity: "sha384-fgyWYkUAamzuI8mJFu/xpRP0JWCJRwkwUwsYDoOYVHUJ8NQE5cENn8ib3ppwFFSX",
  },
  js: {
    file: "swagger-ui-bundle.js",
    integrity: "sha384-m7zaGj7MPzU+G4lz2eyy73GxK9bbRDr9bB2CSdj8wodg2wu/Wnt6wsoLP3JD+RS9",
  },
};

export function docsAssetUrl(file: string): string {
  return `https://unpkg.com/swagger-ui-dist@${docsAssets.version}/${file}`;
}
