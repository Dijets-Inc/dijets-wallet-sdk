/**
 * HD derivation for Dijets wallets, ported from avalanche-wallet-sdk 0.18.3
 * (Wallet/HdScanner.ts, Wallet/constants.ts; BSD-3-Clause, © 2021 Ava Labs).
 *
 *   V- and M-Chain keys: m/44'/9000'/<account>'/<change>/<index>
 *                        (change 0 = receive, 1 = change; the M-Chain uses receive keys)
 *   U-Chain EVM key:     m/44'/60'/0'/0/<account>
 *
 * These are the paths the Dijets web wallet uses, so its mnemonics open with
 * the same addresses. Coin type 9000 is inherited and unchanged.
 */
import { formatAddress, keyHashFromPublicKey, utils, type DijetsClient } from "@dijets/platform-js"

export const DJT_COIN_TYPE = 9000
export const accountPath = (account: number): string => {
  if (!Number.isInteger(account) || account < 0) throw new RangeError("Account index must be a non-negative integer")
  return `m/44'/${DJT_COIN_TYPE}'/${account}'`
}
export const evmAccountRoot = "m/44'/60'/0'"
export const evmPath = (account: number): string => {
  if (!Number.isInteger(account) || account < 0) throw new RangeError("Account index must be a non-negative integer")
  return `${evmAccountRoot}/0/${account}`
}

/** A gap of this many unused addresses ends a scan (BIP44's default). */
export const GAP_LIMIT = 20
const SCAN_BATCH = 70

type HDNode = InstanceType<typeof utils.HDNode>

/**
 * One derivation chain (receive or change) of an account. Works from a
 * private or a public (xpub) account node; keys are only available from a
 * private one.
 */
export class HdChain {
  private index = 0
  private readonly nodes = new Map<number, HDNode>()

  constructor(
    private readonly account: HDNode,
    readonly change: 0 | 1
  ) {}

  /** The first unused index (as last scanned), i.e. the current address. */
  getIndex(): number {
    return this.index
  }
  setIndex(i: number): void {
    if (!Number.isInteger(i) || i < 0) throw new RangeError("Index must be a non-negative integer")
    this.index = i
  }

  node(i: number): HDNode {
    let n = this.nodes.get(i)
    if (!n) {
      n = this.account.derive(`m/${this.change}/${i}`)
      this.nodes.set(i, n)
    }
    return n
  }

  keyHash(i: number): Uint8Array {
    return keyHashFromPublicKey(this.node(i).publicKey)
  }

  address(i: number, chain: string, hrp: string): string {
    return formatAddress(chain, hrp, this.keyHash(i))
  }

  /** Addresses 0…index (inclusive). */
  addresses(chain: string, hrp: string): string[] {
    return Array.from({ length: this.index + 1 }, (_, i) => this.address(i, chain, hrp))
  }

  /** "PrivateKey-…" for index i. Throws for a public-only chain. */
  privateKey(i: number): string {
    const n = this.node(i)
    if (!n.privateKeyCB58) throw new Error("This wallet holds no private keys")
    return n.privateKeyCB58
  }

  /**
   * Finds the first index followed by GAP_LIMIT addresses that hold no UTXOs
   * on the V- or M-Chain, asking the node, and makes it the current index.
   */
  async scan(client: DijetsClient, start = 0): Promise<number> {
    for (let from = start; ; from += SCAN_BATCH - GAP_LIMIT) {
      const v = Array.from({ length: SCAN_BATCH }, (_, k) => this.address(from + k, "V", client.hrp))
      const m = v.map((a) => `M-${a.slice(2)}`)
      const [vu, mu] = await Promise.all([client.vChain.getUTXOs(v), client.mChain.getUTXOs(m)])
      const used = (k: number): boolean => {
        const hash = utils.Buffer.from(this.keyHash(from + k))
        return vu.utxos.getUTXOIDs([hash]).length > 0 || mu.utxos.getUTXOIDs([hash]).length > 0
      }
      let gap = 0
      for (let k = 0; k < SCAN_BATCH; k++) {
        if (used(k)) gap = 0
        else if (++gap === GAP_LIMIT) {
          this.index = from + k - GAP_LIMIT + 1
          return this.index
        }
      }
    }
  }
}
