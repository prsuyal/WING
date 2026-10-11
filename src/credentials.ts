import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export function credentialVault(hexKey: string) {
  if (!/^[a-f0-9]{64}$/i.test(hexKey)) throw new Error("CREDENTIAL_ENCRYPTION_KEY must be 32 bytes in hex");
  const key = Buffer.from(hexKey, "hex");
  return {
    seal(owner: string, value: unknown) {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(owner));
      const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
    },
    open(owner: string, value: string): unknown {
      const packed = Buffer.from(value, "base64"), decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
      decipher.setAAD(Buffer.from(owner)); decipher.setAuthTag(packed.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString());
    },
  };
}
