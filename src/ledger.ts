/**
 * EXPERIMENTAL Ledger wallet, ported from avalanche-wallet-sdk 0.18.3
 * (Wallet/Ledger/LedgerWallet.ts, BSD-3-Clause, © 2021 Ava Labs).
 *
 * There is no Dijets Ledger app. This adapter drives the Avalanche Ledger app
 * (and the Ethereum app for U-Chain EVM transactions) and is untested against
 * a device. Known limits:
 *
 * - V/M/U atomic transactions are signed with the app's hash signing: the
 *   device shows only the transaction hash, not its contents (blind signing),
 *   and hash signing must be enabled in the app's settings. The app cannot
 *   parse Dijets transactions or display Dijets addresses (its address
 *   display accepts at most 4 HRP characters; "dijets" and "lothar" have 6).
 * - Addresses are derived locally from the device's extended public key, so
 *   they match the mnemonic wallet's for the same seed.
 * - Supported: V-Chain transfers, imports and exports; M-Chain imports,
 *   exports, validation and delegation; U-Chain atomic imports and exports;
 *   U-Chain EVM transactions. Name, subnet and Arc transactions are refused.
 *
 * It must be opted into: `LedgerWallet.connect(client, { transport, acknowledgeExperimental: true })`.
 * The Ledger packages are optional peer dependencies:
 * `@ledgerhq/hw-transport`, `@obsidiansystems/hw-app-avalanche`, `@ledgerhq/hw-app-eth`.
 */
import { ethers } from "ethers"
import createHash from "create-hash"
import BIPPath from "bip32-path"
import { DijetsUnsupportedError, vchain, mchain, uchain, utils, common, type DijetsClient } from "@dijets/platform-js"
import { XpubWallet } from "./readonly"
import { xpubFromParts } from "./xpub"
import { accountPath, evmAccountRoot } from "./hd"
import type { WalletCapabilities } from "./wallet"

/** The parts of the Avalanche Ledger app this adapter uses. */
export interface LedgerAvaxApp {
  getWalletExtendedPublicKey(path: string): Promise<{ public_key: Uint8Array; chain_code: Uint8Array }>
  signHash(accountPath: unknown, pathSuffixes: unknown[], hash: Uint8Array): Promise<Map<string, Uint8Array>>
}
/** The parts of the Ethereum Ledger app this adapter uses. */
export interface LedgerEthApp {
  getAddress(path: string, display?: boolean, chainCode?: boolean): Promise<{ publicKey: string; chainCode?: string }>
  signTransaction(path: string, rawTxHex: string, resolution?: unknown): Promise<{ v: string; r: string; s: string }>
}

export interface LedgerConnectOptions {
  /** A Ledger transport (from @ledgerhq/hw-transport-*). */
  transport?: unknown
  /** Apps already constructed (for tests or custom transports). */
  apps?: { avax: LedgerAvaxApp; eth: LedgerEthApp }
  account?: number
  /** Must be true: this adapter is experimental and untested against a device. */
  acknowledgeExperimental: boolean
}

/** BIP32 path objects for hw-app-avalanche, which expects bip32-path instances. */
function bipPath(path: string): unknown {
  return BIPPath.fromString(path)
}

export class LedgerWallet extends XpubWallet {
  readonly kind = "ledger" as const
  readonly capabilities: WalletCapabilities = {
    sign: true,
    hd: true,
    hardware: true,
    experimental: true,
    chains: { V: true, M: true, U: true },
    messageSigning: false,
    exportSecret: false
  }

  private constructor(
    client: DijetsClient,
    private readonly apps: { avax: LedgerAvaxApp; eth: LedgerEthApp },
    xpub: string,
    evmXpub: string,
    account: number
  ) {
    super(client, xpub, evmXpub, account, "account")
  }

  static async connect(client: DijetsClient, options: LedgerConnectOptions): Promise<LedgerWallet> {
    if (options.acknowledgeExperimental !== true) {
      throw new DijetsUnsupportedError(
        "The Ledger wallet is experimental: there is no Dijets Ledger app, it relies on blind hash signing and is untested against a device. Pass acknowledgeExperimental: true to use it."
      )
    }
    const account = options.account ?? 0
    let apps = options.apps
    if (!apps) {
      if (!options.transport) throw new DijetsUnsupportedError("Pass a Ledger transport (or apps)")
      const load = async (name: string) => {
        try {
          const m: any = await import(name)
          return m.default ?? m
        } catch {
          throw new DijetsUnsupportedError(`Install the optional peer dependency ${name} to use the Ledger wallet`)
        }
      }
      const [Avax, Eth] = await Promise.all([load("@obsidiansystems/hw-app-avalanche"), load("@ledgerhq/hw-app-eth")])
      apps = { avax: new Avax(options.transport), eth: new Eth(options.transport) }
    }
    const a = await apps.avax.getWalletExtendedPublicKey(accountPath(account))
    const e = await apps.eth.getAddress(evmAccountRoot, false, true)
    if (!e.chainCode) throw new DijetsUnsupportedError("The Ethereum app did not return a chain code")
    return new LedgerWallet(
      client,
      apps,
      xpubFromParts(a.public_key, a.chain_code, 3),
      xpubFromParts(utils.Buffer.from(e.publicKey, "hex"), utils.Buffer.from(e.chainCode, "hex"), 3),
      account
    )
  }

  /** Signers per credential: each input's signature indices → derivation path suffixes. */
  private credentialPaths(items: any[], evm = false): string[][] {
    return items.map((item) => {
      const input = evm ? item : item.getInput()
      return input.getSigIdxs().map((s: any) => (evm ? `0/${this.account}` : this.pathOf(Uint8Array.from(s.getSource()))))
    })
  }

  private async hashSign<T>(
    unsigned: { toBuffer(): Uint8Array },
    root: string,
    perCredential: string[][],
    makeCredential: () => any,
    build: (creds: any[]) => T
  ): Promise<T> {
    const hash = Uint8Array.from(createHash("sha256").update(utils.Buffer.from(unsigned.toBuffer()) as any).digest())
    const unique = [...new Set(perCredential.flat())]
    const sigs = await this.apps.avax.signHash(bipPath(root), unique.map((p) => bipPath(p)), hash)
    const creds = perCredential.map((paths) => {
      const cred = makeCredential()
      for (const p of paths) {
        const raw = sigs.get(p)
        if (!raw) throw new DijetsUnsupportedError(`The device returned no signature for ${p}`)
        const sig = new common.Signature()
        sig.fromBuffer(utils.Buffer.from(raw))
        cred.addSignature(sig)
      }
      return cred
    })
    return build(creds)
  }

  protected async signV(tx: vchain.UnsignedTx): Promise<vchain.Tx> {
    const body: any = tx.getTransaction()
    const type = body.getTxType()
    if (![vchain.AVMConstants.BASETX, vchain.AVMConstants.EXPORTTX, vchain.AVMConstants.IMPORTTX].includes(type)) {
      throw new DijetsUnsupportedError("The Ledger wallet signs V-Chain transfers, imports and exports only")
    }
    const items = [...body.getIns(), ...(type === vchain.AVMConstants.IMPORTTX ? body.getImportInputs() : [])]
    return this.hashSign(tx, accountPath(this.account), this.credentialPaths(items),
      () => vchain.SelectCredentialClass(vchain.AVMConstants.SECPCREDENTIAL),
      (creds) => new vchain.Tx(tx, creds))
  }

  protected async signM(tx: mchain.UnsignedTx): Promise<mchain.Tx> {
    const body: any = tx.getTransaction()
    const type = body.getTxType()
    const allowed = [mchain.PlatformVMConstants.IMPORTTX, mchain.PlatformVMConstants.EXPORTTX, mchain.PlatformVMConstants.ADDVALIDATORTX, mchain.PlatformVMConstants.ADDDELEGATORTX]
    if (!allowed.includes(type)) {
      throw new DijetsUnsupportedError("The Ledger wallet signs M-Chain imports, exports, validation and delegation only (not name, subnet or Arc transactions)")
    }
    const items = [...body.getIns(), ...(type === mchain.PlatformVMConstants.IMPORTTX ? body.getImportInputs() : [])]
    return this.hashSign(tx, accountPath(this.account), this.credentialPaths(items),
      () => mchain.SelectCredentialClass(mchain.PlatformVMConstants.SECPCREDENTIAL),
      (creds) => new mchain.Tx(tx, creds))
  }

  protected async signU(tx: uchain.UnsignedTx): Promise<uchain.Tx> {
    const body: any = tx.getTransaction()
    const isExport = body.getTxType() === uchain.EVMConstants.EXPORTTX
    // Exports spend EVM inputs signed by the EVM key; imports spend atomic UTXOs owned by it.
    const items = isExport ? body.getInputs() : body.getImportInputs()
    const paths = isExport ? this.credentialPaths(items, true) : items.map((i: any) => i.getInput().getSigIdxs().map(() => `0/${this.account}`))
    return this.hashSign(tx, evmAccountRoot, paths,
      () => uchain.SelectCredentialClass(uchain.EVMConstants.SECPCREDENTIAL),
      (creds) => new uchain.Tx(tx, creds))
  }

  protected async signEvm(tx: ethers.providers.TransactionRequest): Promise<string> {
    const { from: _from, ...rest } = tx
    const unsigned = await ethers.utils.resolveProperties(rest)
    const raw = ethers.utils.serializeTransaction(unsigned as ethers.utils.UnsignedTransaction)
    const sig = await this.apps.eth.signTransaction(`44'/60'/0'/0/${this.account}`, raw.slice(2), null)
    return ethers.utils.serializeTransaction(unsigned as ethers.utils.UnsignedTransaction, {
      r: `0x${sig.r}`,
      s: `0x${sig.s}`,
      v: parseInt(sig.v, 16)
    })
  }
}
