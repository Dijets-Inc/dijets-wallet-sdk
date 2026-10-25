/**
 * Message signing, byte-compatible with the Dijets web wallet (wellar2
 * src/helpers/helper.ts) and avalanche-wallet-sdk: the inherited prefix
 * "<0x1A>Avalanche Signed Message:\n" is kept so signatures stay verifiable by
 * existing tools. The 4-byte length is interpolated as a decoded string,
 * exactly as they do.
 */
import { utils } from "@dijets/platform-js"
import createHash from "create-hash"

const PREFIX = String.fromCharCode(0x1a) + "Avalanche Signed Message:" + String.fromCharCode(0x0a)

export function digestMessage(message: string): Uint8Array {
  const body = utils.Buffer.from(message, "utf8")
  const size = utils.Buffer.alloc(4)
  size.writeUInt32BE(body.length, 0)
  const full = utils.Buffer.from(`${PREFIX}${size}${message}`, "utf8")
  return Uint8Array.from(createHash("sha256").update(full as any).digest())
}
