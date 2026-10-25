/**
 * Encrypted key files (keystores), compatible with the Dijets web wallet and
 * ported from avalanche-wallet-sdk 0.18.3 (src/Keystore/keystore.ts,
 * BSD-3-Clause, © 2021 Ava Labs). Versions 2.0 to 6.0 are read; 6.0 is written.
 *
 * The format fixes the KDF at PBKDF2-SHA256 with 200,000 iterations (100,000
 * for 2.0) and records no parameters, so new files keep those values to stay
 * readable by existing wallets. Use a long password.
 */
import { utils } from "@dijets/platform-js"
import * as bip39 from "bip39"
import { decrypt, encrypt, makeSalt, pwCleaner, pwHash } from "./crypto"

const bintools = utils.BinTools.getInstance()

export const KEYSTORE_VERSION = "6.0"
export const SUPPORTED_KEYSTORE_VERSIONS = ["2.0", "3.0", "4.0", "5.0", "6.0"] as const
const ITERATIONS_V2 = 100_000
const ITERATIONS_V3 = 200_000

export type KeyFileEntryType = "mnemonic" | "singleton"

interface KeyFileKey {
  key: string
  iv: string
  address?: string
  type?: KeyFileEntryType
}

/** A key file as stored (any supported version). */
export interface KeyFile {
  version: string
  salt: string
  /** 2.0–5.0 only. */
  pass_hash?: string
  /** 6.0 only. */
  activeIndex?: number
  keys: KeyFileKey[]
  warnings?: string[]
}

/** A decrypted entry: a mnemonic, or a single key ("PrivateKey-…"). */
export interface KeyFileEntry {
  type: KeyFileEntryType
  secret: string
}

export class KeystoreError extends Error {
  constructor(
    readonly reason: "INVALID_PASSWORD" | "INVALID_VERSION" | "INVALID_FILE",
    message: string
  ) {
    super(message)
    this.name = "KeystoreError"
  }
}

const cb58 = (s: string) => bintools.cb58Decode(s)
const cb58Enc = (b: Uint8Array) => bintools.cb58Encode(utils.Buffer.from(b))

function checkShape(file: unknown): asserts file is KeyFile {
  const f = file as KeyFile
  if (!f || typeof f !== "object" || typeof f.version !== "string" || typeof f.salt !== "string" || !Array.isArray(f.keys)) {
    throw new KeystoreError("INVALID_FILE", "Not a key file")
  }
  if (!SUPPORTED_KEYSTORE_VERSIONS.includes(f.version as never)) {
    throw new KeystoreError("INVALID_VERSION", `Key file version ${f.version} is not supported`)
  }
}

/**
 * Decrypts a key file. Throws `KeystoreError("INVALID_PASSWORD")` for a
 * wrong password. Entries from 2.0–4.0 files (raw keys) are returned as the
 * mnemonic of the key's entropy, exactly as the web wallet does.
 */
export async function readKeyFile(file: unknown, password: string): Promise<{ version: string; activeIndex: number; entries: KeyFileEntry[] }> {
  checkShape(file)
  const v = file.version
  const salt = cb58(file.salt)
  const iterations = v === "2.0" ? ITERATIONS_V2 : ITERATIONS_V3

  if (v !== "6.0") {
    const check = v === "2.0" ? await pwCleaner(password, salt) : await pwHash(password, salt)
    if (cb58Enc(check) !== file.pass_hash) throw new KeystoreError("INVALID_PASSWORD", "Wrong password")
  }
  const entries: KeyFileEntry[] = []
  for (const k of file.keys) {
    let plain: Uint8Array
    try {
      plain = await decrypt(password, cb58(k.key), salt, cb58(k.iv), iterations)
    } catch {
      throw new KeystoreError("INVALID_PASSWORD", "Wrong password")
    }
    if (v === "6.0") {
      entries.push({ type: k.type === "singleton" ? "singleton" : "mnemonic", secret: utils.Buffer.from(plain).toString("utf8") })
    } else if (v === "5.0") {
      entries.push({ type: "mnemonic", secret: utils.Buffer.from(plain).toString("utf8") })
    } else {
      // 2.0–4.0 stored raw private keys; the web wallet opens them as the
      // 24-word mnemonic of the key bytes (extractKeysV2 upstream).
      const hex = utils.Buffer.from(plain).toString("hex").padStart(64, "0")
      entries.push({ type: "mnemonic", secret: bip39.entropyToMnemonic(hex) })
    }
    plain.fill?.(0)
  }
  return { version: v, activeIndex: file.activeIndex ?? 0, entries }
}

/** Writes a 6.0 key file. `entries` are mnemonics or "PrivateKey-…" keys. */
export async function makeKeyFile(entries: KeyFileEntry[], password: string, activeIndex = 0): Promise<KeyFile> {
  if (!password) throw new KeystoreError("INVALID_PASSWORD", "A password is required")
  const salt = makeSalt()
  const keys: KeyFileKey[] = []
  for (const e of entries) {
    const { iv, ciphertext } = await encrypt(password, e.secret, salt, ITERATIONS_V3)
    keys.push({ key: cb58Enc(ciphertext), iv: cb58Enc(iv), type: e.type })
  }
  return { version: KEYSTORE_VERSION, salt: cb58Enc(salt), activeIndex, keys }
}
