/**
 * A wallet from a BIP-39 mnemonic: HD addresses on the V- and M-Chains and
 * an EVM account on the U-Chain (see hd.ts for the paths). Ported from
 * avalanche-wallet-sdk 0.18.3 MnemonicWallet (BSD-3-Clause, © 2021 Ava Labs).
 */
import * as bip39 from "bip39"
import { utils, type DijetsClient } from "@dijets/platform-js"
import { KeyWallet } from "./keywallet"
import { HdChain, accountPath, evmAccountRoot, evmPath } from "./hd"
import { Secret } from "./secret"
import { makeKeyFile, type KeyFile } from "./keystore/keystore"
import type { WalletCapabilities } from "./wallet"

export class MnemonicWallet extends KeyWallet {
  readonly kind = "mnemonic" as const
  readonly capabilities: WalletCapabilities = {
    sign: true,
    hd: true,
    hardware: false,
    experimental: false,
    chains: { V: true, M: true, U: true },
    messageSigning: true,
    exportSecret: true
  }
  private readonly mnemonic: Secret
  protected readonly evmKey: Secret
  /** Receive (0) and change (1) chains of the account. */
  readonly receive: HdChain
  readonly change: HdChain
  private readonly xpub: string
  private readonly evmXpub: string

  private constructor(client: DijetsClient, mnemonic: string, readonly account: number) {
    super(client)
    const words = mnemonic.trim().split(/\s+/).join(" ")
    if (!bip39.validateMnemonic(words)) throw new Error("Invalid mnemonic phrase")
    const seed = bip39.mnemonicToSeedSync(words)
    const master = new utils.HDNode(utils.Buffer.from(seed))
    seed.fill(0)
    const accountNode = master.derive(accountPath(account))
    this.xpub = accountNode.publicExtendedKey
    this.receive = new HdChain(accountNode, 0)
    this.change = new HdChain(accountNode, 1)
    this.evmXpub = master.derive(evmAccountRoot).publicExtendedKey
    const evm = master.derive(evmPath(account))
    this.evmKey = new Secret(`0x${evm.privateKey.toString("hex")}`)
    evm.wipePrivateData()
    master.wipePrivateData()
    this.mnemonic = new Secret(words)
  }

  /** A new 24-word mnemonic. */
  static generateMnemonic(): string {
    return bip39.generateMnemonic(256)
  }
  static validateMnemonic(mnemonic: string): boolean {
    return bip39.validateMnemonic(mnemonic.trim().split(/\s+/).join(" "))
  }
  /** A wallet with a fresh mnemonic. Back the mnemonic up (`exportKeyFile` or `getMnemonic`). */
  static create(client: DijetsClient, account = 0): MnemonicWallet {
    return new MnemonicWallet(client, MnemonicWallet.generateMnemonic(), account)
  }
  /** Opens an existing mnemonic. Call `scan()` to find addresses already in use. */
  static fromMnemonic(client: DijetsClient, mnemonic: string, account = 0): MnemonicWallet {
    return new MnemonicWallet(client, mnemonic, account)
  }

  /** Finds the receive and change indexes in use (BIP-44 gap of 20), asking the node. */
  async scan(): Promise<{ receive: number; change: number }> {
    const [receive, change] = await Promise.all([this.receive.scan(this.client), this.change.scan(this.client)])
    return { receive, change }
  }

  getAddress(chain: "V" | "M"): string {
    return this.receive.address(this.receive.getIndex(), chain, this.client.hrp)
  }
  getChangeAddress(): string {
    return this.change.address(this.change.getIndex(), "V", this.client.hrp)
  }
  getAddresses(chain: "V" | "M"): string[] {
    // As the web wallet: the M-Chain uses receive addresses only.
    const r = this.receive.addresses(chain, this.client.hrp)
    return chain === "M" ? r : [...r, ...this.change.addresses("V", this.client.hrp)]
  }
  /** The account-level extended public key (m/44'/9000'/account'), for a read-only wallet. */
  getXpub(): string {
    return this.xpub
  }
  /** The EVM account xpub (m/44'/60'/0'), the second half of a read-only wallet. */
  getEvmXpub(): string {
    return this.evmXpub
  }

  protected privateKeys(chain: "V" | "M"): string[] {
    const r = Array.from({ length: this.receive.getIndex() + 1 }, (_, i) => this.receive.privateKey(i))
    if (chain === "M") return r
    return [...r, ...Array.from({ length: this.change.getIndex() + 1 }, (_, i) => this.change.privateKey(i))]
  }
  protected messageKey(index = this.receive.getIndex()): string {
    return this.receive.privateKey(index)
  }

  /** The mnemonic. Show it only to its owner; never log or send it. */
  getMnemonic(): string {
    return this.mnemonic.reveal()
  }

  /** An encrypted key file (format 6.0, compatible with the web wallet). */
  exportKeyFile(password: string): Promise<KeyFile> {
    return makeKeyFile([{ type: "mnemonic", secret: this.mnemonic.reveal() }], password)
  }

  /** Overwrites the in-memory secrets. The wallet cannot sign afterwards. */
  wipe(): void {
    this.mnemonic.wipe()
    this.evmKey.wipe()
  }
}
