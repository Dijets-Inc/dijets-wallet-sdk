/**
 * A wallet of one private key, the same key on every chain (as the web
 * wallet: the V/M key's 32 bytes are also the U-Chain EVM key). Ported from
 * avalanche-wallet-sdk 0.18.3 SingletonWallet (BSD-3-Clause, © 2021 Ava Labs).
 */
import { formatAddress, vchain, utils, type DijetsClient } from "@dijets/platform-js"
import { KeyWallet } from "./keywallet"
import { Secret } from "./secret"
import { makeKeyFile, type KeyFile } from "./keystore/keystore"
import type { WalletCapabilities } from "./wallet"

const bintools = utils.BinTools.getInstance()

export class SingletonWallet extends KeyWallet {
  readonly kind = "singleton" as const
  readonly capabilities: WalletCapabilities = {
    sign: true,
    hd: false,
    hardware: false,
    experimental: false,
    chains: { V: true, M: true, U: true },
    messageSigning: true,
    exportSecret: true
  }
  private readonly key: Secret
  protected readonly evmKey: Secret
  private readonly keyHash: Uint8Array

  private constructor(client: DijetsClient, privateKey: string) {
    super(client)
    const kp = new vchain.KeyChain(client.hrp, "V").importKey(privateKey)
    this.keyHash = Uint8Array.from(kp.getAddress())
    const raw = kp.getPrivateKey()
    this.key = new Secret(`PrivateKey-${bintools.cb58Encode(raw)}`)
    this.evmKey = new Secret(`0x${raw.toString("hex").padStart(64, "0")}`)
  }

  /** From "PrivateKey-…" (cb58) or a 0x-prefixed 32-byte hex key. */
  static fromPrivateKey(client: DijetsClient, privateKey: string): SingletonWallet {
    const k = /^0x[0-9a-fA-F]{64}$/.test(privateKey)
      ? `PrivateKey-${bintools.cb58Encode(utils.Buffer.from(privateKey.slice(2), "hex"))}`
      : privateKey
    if (!k.startsWith("PrivateKey-")) throw new Error('Expected "PrivateKey-…" or a 0x-prefixed hex key')
    return new SingletonWallet(client, k)
  }

  getAddress(chain: "V" | "M"): string {
    return formatAddress(chain, this.client.hrp, this.keyHash)
  }
  getChangeAddress(): string {
    return this.getAddress("V")
  }
  getAddresses(chain: "V" | "M"): string[] {
    return [this.getAddress(chain)]
  }
  protected privateKeys(): string[] {
    return [this.key.reveal()]
  }
  protected messageKey(): string {
    return this.key.reveal()
  }

  /** The private key ("PrivateKey-…"). Never log or send it. */
  getPrivateKey(): string {
    return this.key.reveal()
  }

  exportKeyFile(password: string): Promise<KeyFile> {
    return makeKeyFile([{ type: "singleton", secret: this.key.reveal() }], password)
  }

  wipe(): void {
    this.key.wipe()
    this.evmKey.wipe()
  }
}
