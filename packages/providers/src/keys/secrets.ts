import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Envelope for users' provider keys: AES-256-GCM with a random 96-bit IV and associated data that binds
 * the ciphertext to its owner and provider, so a row copied to another user or provider won't decrypt.
 * Format: `v1.<iv>.<tag>.<ciphertext>` (base64url).
 */
export class SecretBox {
  private readonly key: Buffer;

  /** `masterKey`: SHORTLOOP_SECRETS_KEY (any high-entropy string; hashed to 32 bytes). */
  constructor(masterKey: string) {
    if (masterKey.length < 16) throw new Error("SHORTLOOP_SECRETS_KEY must be at least 16 characters");
    this.key = createHash("sha256").update(masterKey).digest();
  }

  seal(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const b = (x: Buffer) => x.toString("base64url");
    return `v1.${b(iv)}.${b(cipher.getAuthTag())}.${b(ct)}`;
  }

  open(sealed: string, aad: string): string {
    const [v, iv, tag, ct] = sealed.split(".");
    if (v !== "v1" || !iv || !tag || !ct) throw new Error("unrecognised secret format");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  }
}

export const keyAad = (ownerId: string, provider: string) => `user_api_key:${ownerId}:${provider}`;

/**
 * The box for this process. In production SHORTLOOP_SECRETS_KEY is required; elsewhere a fixed dev key
 * is used so local runs and tests work without setup.
 */
export function secretBoxFromEnv(env: NodeJS.ProcessEnv = process.env): SecretBox {
  const key = env.SHORTLOOP_SECRETS_KEY;
  if (key) return new SecretBox(key);
  if (env.NODE_ENV === "production" && env.SHORTLOOP_FAKE_PROVIDERS !== "1") {
    throw new Error("SHORTLOOP_SECRETS_KEY is not set, so user API keys can't be stored safely.");
  }
  return new SecretBox("dev-only-secrets-key-not-for-production");
}

/** Last four characters for display ("••••abcd"). */
export const last4 = (key: string) => key.trim().slice(-4);
