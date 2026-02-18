import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

export class EncryptionUtil {
  constructor(secret) {
    this.key = createHash("sha256").update(secret, "utf8").digest();
  }

  encrypt(plainText) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
  }

  decrypt(payload) {
    const [ivB64, tagB64, encryptedB64] = payload.split(".");
    if (!ivB64 || !tagB64 || !encryptedB64) {
      throw new Error("Invalid encrypted payload format.");
    }
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const encrypted = Buffer.from(encryptedB64, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  }
}
