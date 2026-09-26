/** Update URLs and hashes together with scripts/verify-cdn.ts. */
export const docsAssets = {
  version: "5.33.0",
  css: {
    file: "swagger-ui.css",
    integrity: "sha384-Ov4/wv3j2bmct8cDc5X4ngJZohVPzEmc6uDPH8WeljUxO5vtoykvMEfbu9Vh6RaW",
  },
  js: {
    file: "swagger-ui-bundle.js",
    integrity: "sha384-YDALVcy8kj8yltLBVi1vBiBAUqdxvus673gM8XKwiy6aDUJFXivF/KCufekjYbVf",
  },
};

export function docsAssetUrl(file: string): string {
  return `https://unpkg.com/swagger-ui-dist@${docsAssets.version}/${file}`;
}
