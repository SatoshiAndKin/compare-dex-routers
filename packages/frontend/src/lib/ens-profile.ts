import { createClient, http, isAddress } from "viem";
import { getEnsName, getEnsText } from "viem/actions";
import { mainnet } from "viem/chains";
import { normalize, parseAvatarRecord } from "viem/ens";

const imageSource = /^(https:\/\/|data:image\/)/i;
const client = createClient({
  chain: mainnet,
  transport: http(undefined, {
    retryCount: 0,
    timeout: 5_000,
    fetchOptions: { referrerPolicy: "no-referrer" },
  }),
});

export async function lookupEnsName(address: string): Promise<string | null> {
  if (!isAddress(address, { strict: false })) return null;
  const name = await getEnsName(client, { address });
  return name ? normalize(name) : null;
}

export async function lookupEnsAvatar(name: string): Promise<string | null> {
  const record = await getEnsText(client, { name, key: "avatar" });
  if (!record) return null;
  // Load direct image records in the image element, including hosts without CORS.
  const avatar = imageSource.test(record) ? record : await parseAvatarRecord(client, { record });
  return imageSource.test(avatar) ? avatar : null;
}
