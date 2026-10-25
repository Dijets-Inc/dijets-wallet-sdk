/**
 * BIP-32 extended public keys, built and inspected without a Node Buffer
 * dependency: base58check(version ‖ depth ‖ parent fingerprint ‖ child number
 * ‖ chain code ‖ compressed public key).
 */
import { ethers } from "ethers"
import createHash from "create-hash"
import { utils } from "@dijets/platform-js"

const XPUB_VERSION = [0x04, 0x88, 0xb2, 0x1e]
const sha256 = (b: Uint8Array) => Uint8Array.from(createHash("sha256").update(utils.Buffer.from(b) as any).digest())

/** An xpub for a node known only by its public key and chain code (e.g. from a Ledger). */
export function xpubFromParts(publicKey: Uint8Array, chainCode: Uint8Array, depth: number): string {
  const pub = ethers.utils.arrayify(ethers.utils.computePublicKey(publicKey, true))
  if (chainCode.length !== 32) throw new Error("A chain code is 32 bytes")
  const payload = utils.Buffer.concat([
    utils.Buffer.from(XPUB_VERSION),
    utils.Buffer.from([depth]),
    utils.Buffer.alloc(4), // parent fingerprint: unknown, not needed for derivation
    utils.Buffer.alloc(4), // child number
    utils.Buffer.from(chainCode),
    utils.Buffer.from(pub)
  ])
  const checksum = sha256(sha256(payload)).slice(0, 4)
  return utils.Base58.getInstance().encode(utils.Buffer.concat([payload, utils.Buffer.from(checksum)]))
}

/** The depth recorded in an xpub (3 for an account, 5 for an address). */
export function xpubDepth(xpub: string): number {
  const raw = utils.Base58.getInstance().decode(xpub)
  const body = raw.slice(0, -4)
  const check = sha256(sha256(body)).slice(0, 4)
  if (utils.Buffer.compare(utils.Buffer.from(check), raw.slice(-4)) !== 0) throw new Error("Invalid xpub checksum")
  return body[4]
}
