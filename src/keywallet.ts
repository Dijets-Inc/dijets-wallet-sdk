/**
 * Signing for wallets that hold their keys in this process (mnemonic and
 * single-key wallets). Keychains are built for the moment of signing and not
 * kept.
 */
import { ethers } from "ethers"
import { formatAddress, keyHashFromPublicKey, vchain, mchain, uchain, utils, type DijetsClient } from "@dijets/platform-js"
import { Wallet } from "./wallet"
import { digestMessage } from "./message"
import { Secret } from "./secret"

const bintools = utils.BinTools.getInstance()

export abstract class KeyWallet extends Wallet {
  /** The EVM private key (hex, 0x-prefixed). */
  protected abstract readonly evmKey: Secret

  protected constructor(client: DijetsClient) {
    super(client)
  }

  /** "PrivateKey-…" keys for the V-Chain (all in use) and the M-Chain. */
  protected abstract privateKeys(chain: "V" | "M"): string[]
  /** The key that signs messages for `index`. */
  protected abstract messageKey(index?: number): string

  protected keyChain<K extends { importKey(k: string): unknown }>(kc: K, keys: string[]): K {
    for (const k of keys) kc.importKey(k)
    return kc
  }

  protected async signV(tx: vchain.UnsignedTx): Promise<vchain.Tx> {
    return tx.sign(this.keyChain(new vchain.KeyChain(this.client.hrp, "V"), this.privateKeys("V")))
  }
  protected async signM(tx: mchain.UnsignedTx): Promise<mchain.Tx> {
    // M-Chain transactions can also need V-Chain keys (a name's target), so include both.
    return tx.sign(this.keyChain(new mchain.KeyChain(this.client.hrp, "M"), [...new Set([...this.privateKeys("M"), ...this.privateKeys("V")])]))
  }
  protected async signU(tx: uchain.UnsignedTx): Promise<uchain.Tx> {
    const raw = utils.Buffer.from(this.evmKey.reveal().slice(2), "hex")
    const kc = new uchain.KeyChain(this.client.hrp, "U")
    kc.importKey(`PrivateKey-${bintools.cb58Encode(raw)}`)
    raw.fill(0)
    return tx.sign(kc)
  }
  protected async signEvm(tx: ethers.providers.TransactionRequest): Promise<string> {
    const { from: _from, ...unsignedTx } = tx
    return new ethers.Wallet(this.evmKey.reveal()).signTransaction(unsignedTx)
  }

  getEvmAddress(): string {
    return ethers.utils.computeAddress(this.evmKey.reveal())
  }
  getUAtomicAddress(): string {
    const pub = ethers.utils.arrayify(ethers.utils.computePublicKey(this.evmKey.reveal(), true))
    return formatAddress("U", this.client.hrp, keyHashFromPublicKey(pub))
  }

  /** Signs a message with a V-Chain key (web-wallet compatible); returns a cb58 signature. */
  signMessage(message: string, index?: number): string {
    const kc = new vchain.KeyChain(this.client.hrp, "V")
    const key = kc.importKey(this.messageKey(index))
    return bintools.cb58Encode(key.sign(utils.Buffer.from(digestMessage(message))))
  }

  /** Signs a message with the U-Chain EVM key (EIP-191 personal_sign). */
  signEvmMessage(message: string): Promise<string> {
    return new ethers.Wallet(this.evmKey.reveal()).signMessage(message)
  }
}

/** Recovers the V-Chain address that signed a message with `signMessage`. */
export function verifyMessage(message: string, signatureCB58: string, hrp: string): string {
  const sig = bintools.cb58Decode(signatureCB58)
  const kp = new vchain.KeyPair(hrp, "V")
  const pub = kp.recover(utils.Buffer.from(digestMessage(message)), sig)
  return formatAddress("V", hrp, keyHashFromPublicKey(pub))
}
