/**
 * Wallets addressed from extended public keys (xpub): the read-only wallet,
 * and the base of the Ledger wallet (whose keys stay on the device). Ported
 * from avalanche-wallet-sdk 0.18.3 PublicMnemonicWallet (BSD-3-Clause,
 * © 2021 Ava Labs).
 */
import { ethers } from "ethers"
import { xpubDepth } from "./xpub"
import { DijetsUnsupportedError, formatAddress, keyHashFromPublicKey, utils, type DijetsClient, vchain, mchain, uchain } from "@dijets/platform-js"
import { HdChain } from "./hd"
import { Wallet, type WalletCapabilities } from "./wallet"

export abstract class XpubWallet extends Wallet {
  readonly receive: HdChain
  readonly change: HdChain
  protected readonly evmPublicKey: Uint8Array

  /**
   * @param xpub     The account xpub at m/44'/9000'/account'.
   * @param evmXpub  The EVM xpub, at the level `evmLevel` names.
   * @param evmLevel "account": m/44'/60'/0' (the key is its child 0/account);
   *                 "address": m/44'/60'/0'/0/account itself.
   */
  protected constructor(client: DijetsClient, xpub: string, evmXpub: string, readonly account: number, evmLevel: "account" | "address") {
    super(client)
    if (!xpub.startsWith("xpub") || !evmXpub.startsWith("xpub")) throw new Error("Expected extended public keys (xpub…)")
    const node = new utils.HDNode(xpub)
    this.receive = new HdChain(node, 0)
    this.change = new HdChain(node, 1)
    const evmNode = new utils.HDNode(evmXpub)
    this.evmPublicKey = Uint8Array.from(evmLevel === "account" ? evmNode.derive(`m/0/${account}`).publicKey : evmNode.publicKey)
  }

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
    const r = this.receive.addresses(chain, this.client.hrp)
    return chain === "M" ? r : [...r, ...this.change.addresses("V", this.client.hrp)]
  }
  getEvmAddress(): string {
    return ethers.utils.computeAddress(this.evmPublicKey)
  }
  getUAtomicAddress(): string {
    return formatAddress("U", this.client.hrp, keyHashFromPublicKey(this.evmPublicKey))
  }

  /** The derivation path suffix ("0/i" or "1/i") of an address this wallet owns. */
  protected pathOf(keyHash: Uint8Array): string {
    const hex = utils.Buffer.from(keyHash).toString("hex")
    for (const [chain, c] of [[0, this.receive], [1, this.change]] as const) {
      for (let i = 0; i <= c.getIndex(); i++) {
        if (utils.Buffer.from(c.keyHash(i)).toString("hex") === hex) return `${chain}/${i}`
      }
    }
    throw new DijetsUnsupportedError(`Address ${hex} is not one of this wallet's derived addresses; call scan()`)
  }
}

export class ReadOnlyWallet extends XpubWallet {
  readonly kind = "read-only" as const
  readonly capabilities: WalletCapabilities = {
    sign: false,
    hd: true,
    hardware: false,
    experimental: false,
    chains: { V: true, M: true, U: true },
    messageSigning: false,
    exportSecret: false
  }

  /** From `MnemonicWallet.getXpub()` and the EVM account xpub at m/44'/60'/0'. */
  /**
   * The EVM xpub may be at the account level (m/44'/60'/0', as `getEvmXpub()`
   * returns) or at the address level (m/44'/60'/0'/0/account, as upstream's
   * read-only wallet takes it); the xpub's depth tells which.
   */
  static fromXpub(client: DijetsClient, xpub: string, evmXpub: string, account = 0): ReadOnlyWallet {
    const depth = xpubDepth(evmXpub)
    if (depth !== 3 && depth !== 5) throw new Error(`Expected the EVM xpub at m/44'/60'/0' or m/44'/60'/0'/0/n (depth 3 or 5), got depth ${depth}`)
    return new ReadOnlyWallet(client, xpub, evmXpub, account, depth === 3 ? "account" : "address")
  }

  private refuse(): never {
    throw new DijetsUnsupportedError("This is a read-only wallet: it holds no keys and cannot sign")
  }
  protected signV(_tx: vchain.UnsignedTx): Promise<vchain.Tx> {
    return this.refuse()
  }
  protected signM(_tx: mchain.UnsignedTx): Promise<mchain.Tx> {
    return this.refuse()
  }
  protected signU(_tx: uchain.UnsignedTx): Promise<uchain.Tx> {
    return this.refuse()
  }
  protected signEvm(): Promise<string> {
    return this.refuse()
  }
}
