/**
 * Key-file encryption, ported from avalanche-wallet-sdk 0.18.3
 * (src/Keystore/Crypto.ts, BSD-3-Clause, © 2021 Ava Labs) and identical to
 * the Dijets web wallet's (wellar2 src/js/Crypto.ts): PBKDF2-SHA256 over
 * sha256(password ‖ salt), then AES-256-GCM with the salt as additional data.
 *
 * Change from upstream: the iteration count is an argument. Upstream kept it
 * on a shared instance and set it before each read, so concurrent reads of
 * files of different versions could use the wrong count.
 */
import { utils } from "@dijets/platform-js"

const { Buffer } = utils
type Buffer = InstanceType<typeof utils.Buffer>

const IV_SIZE = 12
const SALT_SIZE = 16
const TAG_LENGTH = 128
const AES_LENGTH = 256

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto
  if (!c?.subtle) throw new Error("WebCrypto is not available (Node 20+ or a browser is required)")
  return c.subtle
}

const sha256 = async (data: Uint8Array): Promise<Buffer> => Buffer.from(await subtle().digest("SHA-256", data))

/** sha256(utf8(password) ‖ salt), the password pre-hash used by every version. */
export const pwCleaner = (password: string, salt: Uint8Array): Promise<Buffer> =>
  sha256(Buffer.concat([Buffer.from(password, "utf8"), Buffer.from(salt)]))

/** The v3+ password check hash: pwCleaner(password, pwCleaner(password, salt)). */
export const pwHash = async (password: string, salt: Uint8Array): Promise<Buffer> =>
  pwCleaner(password, await pwCleaner(password, salt))

export const makeSalt = (): Buffer => {
  const salt = Buffer.alloc(SALT_SIZE)
  globalThis.crypto.getRandomValues(salt)
  return salt
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await subtle().importKey("raw", new Uint8Array(await pwCleaner(password, salt)), { name: "PBKDF2" }, false, ["deriveKey"])
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: AES_LENGTH },
    false,
    ["encrypt", "decrypt"]
  )
}

export async function encrypt(
  password: string,
  plaintext: Uint8Array | string,
  salt: Uint8Array,
  iterations: number
): Promise<{ iv: Buffer; ciphertext: Buffer }> {
  const key = await deriveKey(password, salt, iterations)
  const iv = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(IV_SIZE)))
  const pt = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: salt, tagLength: TAG_LENGTH }, key, pt)
  return { iv, ciphertext: Buffer.from(ct) }
}

/** Throws if the password is wrong (AES-GCM authentication fails). */
export async function decrypt(password: string, ciphertext: Uint8Array, salt: Uint8Array, iv: Uint8Array, iterations: number): Promise<Buffer> {
  const key = await deriveKey(password, salt, iterations)
  const pt = await subtle().decrypt({ name: "AES-GCM", iv, additionalData: salt, tagLength: TAG_LENGTH }, key, ciphertext)
  return Buffer.from(pt)
}
