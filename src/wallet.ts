/**
 * The wallet: addresses, balances, transfers, cross-chain moves, staking,
 * NFTs, names and Arcs over a `DijetsClient`, with signing supplied by the
 * concrete wallet (mnemonic, single key, read-only, Ledger).
 *
 * Every operation that moves funds is prepare → sign → submit: `prepare*`
 * returns a `PreparedTx` you can inspect (recipient, amount, fee) before
 * `submit()` signs and issues it. Signing happens in this process; no secret
 * is ever sent to a node.
 */
import BN from "bn.js"
import { ethers } from "ethers"
import {
  canonicaliseName,
  DijetsAddressError,
  DijetsTxError,
  DijetsUnsupportedError,
  formatAddress,
  formatDJT,
  isEvmAddress,
  parseAddress,
  toEvmChecksumAddress,
  vchain,
  mchain,
  uchain,
  common,
  utils,
  type DijetsClient,
  type PaymentRecipient
} from "@dijets/platform-js"

export type Chain = "V" | "M" | "U"

export interface WalletCapabilities {
  /** Can sign transactions. False for read-only wallets. */
  sign: boolean
  /** Derives many addresses from one seed. */
  hd: boolean
  /** Keys live on a hardware device. */
  hardware: boolean
  /** Not verified against a device or not fully supported. */
  experimental: boolean
  /** Which chains the wallet can transact on. */
  chains: Record<Chain, boolean>
  /** Can sign arbitrary messages. */
  messageSigning: boolean
  /** Can export its secret (mnemonic or key) to a key file. */
  exportSecret: boolean
}

export type WalletKind = "mnemonic" | "singleton" | "read-only" | "ledger"

export interface AssetBalance {
  assetID: string
  /** Spendable now. */
  unlocked: bigint
  /** Time-locked. */
  locked: bigint
}

export interface WalletBalance {
  /** V-Chain balances by asset ID; DJT is under `client.network.djtAssetID`. */
  V: Record<string, AssetBalance>
  /** M-Chain DJT (nDJT). */
  M: { unlocked: bigint; lockedStakeable: bigint; lockedNotStakeable: bigint; staked: bigint }
  /** U-Chain DJT in wei (18 decimals). */
  U: bigint
}

/** A recipient after resolution: always an address; `name` when it came from the registry. */
export interface Recipient {
  address: string
  name?: PaymentRecipient
}

export interface PreparedTx {
  chain: Chain
  /** What it does, for showing to the user before signing. */
  description: string
  /** nDJT. */
  fee: bigint
  recipient?: Recipient
  /** @internal the unsigned transaction. */
  unsigned: vchain.UnsignedTx | mchain.UnsignedTx | uchain.UnsignedTx
}

const bn = (v: bigint | number): BN => new BN(v.toString())
const big = (v: { toString(): string } | undefined): bigint => BigInt((v ?? "0").toString())
const now = (): bigint => BigInt(Math.floor(Date.now() / 1000))
const inspect = Symbol.for("nodejs.util.inspect.custom")

export abstract class Wallet {
  abstract readonly kind: WalletKind
  abstract readonly capabilities: WalletCapabilities

  protected constructor(readonly client: DijetsClient) {}

  // ---- addresses ----------------------------------------------------------

  /** The current receive address on the V- or M-Chain. */
  abstract getAddress(chain: "V" | "M"): string
  /** Where V-Chain change goes. */
  abstract getChangeAddress(): string
  /** Every address in use on the V- or M-Chain (HD wallets: up to the current index). */
  abstract getAddresses(chain: "V" | "M"): string[]
  /** The U-Chain EVM account (0x…). */
  abstract getEvmAddress(): string
  /** The EVM key's bech32 U-Chain address, used by atomic import and export. */
  abstract getUAtomicAddress(): string

  // ---- signing (supplied by each wallet) ------------------------------------

  protected abstract signV(tx: vchain.UnsignedTx): Promise<vchain.Tx>
  protected abstract signM(tx: mchain.UnsignedTx): Promise<mchain.Tx>
  protected abstract signU(tx: uchain.UnsignedTx): Promise<uchain.Tx>
  /** Signs a fully populated EVM transaction and returns the raw signed hex. */
  protected abstract signEvm(tx: ethers.providers.TransactionRequest): Promise<string>

  protected requireSigning(what: string): void {
    if (!this.capabilities.sign) throw new DijetsUnsupportedError(`${what} needs a signing wallet; this wallet is ${this.kind}`)
  }

  // ---- reads --------------------------------------------------------------

  /** Every UTXO the wallet's addresses own on the V- or M-Chain (or atomic UTXOs from `sourceChain`). */
  async getUtxos(chain: "V" | "M", sourceChain?: Chain): Promise<any> {
    const api: any = chain === "V" ? this.client.vChain : this.client.mChain
    const addresses = this.getAddresses(chain)
    const source = sourceChain ? this.chainID(sourceChain) : undefined
    let page = await api.getUTXOs(addresses, source)
    const set = page.utxos
    while (page.numFetched >= 1024 && page.endIndex) {
      page = await api.getUTXOs(addresses, source, 0, page.endIndex)
      set.addArray(page.utxos.getAllUTXOs())
    }
    return set
  }

  async getBalance(): Promise<WalletBalance> {
    const [vSet, m, stake, u] = await Promise.all([
      this.getUtxos("V"),
      this.client.transport.call("/ext/bc/M", "platform.getBalance", { addresses: this.getAddresses("M") }),
      this.client.mChain.getStake(this.getAddresses("M")),
      this.client.uChainEvm.getBalance(this.getEvmAddress())
    ])
    const V: Record<string, AssetBalance> = {}
    const t = now()
    for (const utxo of vSet.getAllUTXOs()) {
      const out: any = utxo.getOutput()
      if (typeof out.getAmount !== "function") continue // NFTs and other non-fungible outputs
      const id = utils.BinTools.getInstance().cb58Encode(utxo.getAssetID())
      const b = (V[id] ??= { assetID: id, unlocked: 0n, locked: 0n })
      const amount = big(out.getAmount())
      if (big(out.getLocktime()) > t) b.locked += amount
      else b.unlocked += amount
    }
    return {
      V,
      M: {
        unlocked: big(m.unlocked),
        lockedStakeable: big(m.lockedStakeable),
        lockedNotStakeable: big(m.lockedNotStakeable),
        staked: big((stake as any).staked)
      },
      U: u
    }
  }

  /** Spendable DJT on the V- or M-Chain, in nDJT. */
  async getDJTBalance(chain: "V" | "M"): Promise<bigint> {
    const b = await this.getBalance()
    return chain === "V" ? (b.V[this.client.network.djtAssetID as string]?.unlocked ?? 0n) : b.M.unlocked
  }

  // ---- recipients ---------------------------------------------------------

  /**
   * Accepts an address or a registered name and returns a checked address on
   * `chain` of this network. A name is resolved through the registry (it must
   * be ACTIVE); names point at V/M key hashes and cannot name an EVM account.
   */
  async resolveRecipient(input: string, chain: Chain): Promise<Recipient> {
    const text = input.trim()
    if (chain !== "U" && isEvmAddress(text)) {
      throw new DijetsAddressError(`${text} is a U-Chain EVM address; the ${chain}-Chain needs a bech32 address such as ${chain}-${this.client.hrp}1…`)
    }
    if (chain === "U") {
      if (!isEvmAddress(text)) throw new DijetsUnsupportedError("U-Chain recipients are 0x addresses; names cannot point at EVM accounts")
      return { address: toEvmChecksumAddress(text) }
    }
    if (text.includes("-") && /1[02-9ac-hj-np-z]{6,}$/.test(text)) {
      const a = parseAddress(text, { chain: [chain], hrp: this.client.hrp })
      return { address: formatAddress(chain, a.hrp, a.bytes) }
    }
    const name = canonicaliseName(text)
    const r = await this.client.names.resolveForPayment(name, 600n)
    const a = parseAddress(r.address, { hrp: this.client.hrp })
    return { address: formatAddress(chain, a.hrp, a.bytes), name: r }
  }

  // ---- V-Chain transfers ----------------------------------------------------

  /** A V-Chain transfer of DJT (or another asset) to an address or name. */
  async prepareSend(req: { to: string; amount: bigint; assetID?: string; memo?: string }): Promise<PreparedTx> {
    const recipient = await this.resolveRecipient(req.to, "V")
    const asset = req.assetID ?? (this.client.network.djtAssetID as string)
    const unsigned = await this.client.vChain.buildBaseTx(
      await this.getUtxos("V"),
      bn(req.amount),
      asset,
      [recipient.address],
      this.getAddresses("V"),
      [this.getChangeAddress()],
      req.memo ? utils.Buffer.from(req.memo, "utf8") : undefined
    )
    const via = recipient.name ? ` (${recipient.name.name})` : ""
    return {
      chain: "V",
      description: `Send ${asset === this.client.network.djtAssetID ? `${formatDJT(req.amount)} DJT` : `${req.amount} units of asset ${asset}`} to ${recipient.address}${via} on the V-Chain`,
      fee: this.client.network.fees.txFee,
      recipient,
      unsigned
    }
  }

  /** Signs and issues a prepared transaction; returns its ID. */
  async submit(prepared: PreparedTx): Promise<string> {
    this.requireSigning("Submitting a transaction")
    switch (prepared.chain) {
      case "V":
        return this.client.vChain.issueTx(await this.signV(prepared.unsigned as vchain.UnsignedTx))
      case "M":
        return this.client.mChain.issueTx(await this.signM(prepared.unsigned as mchain.UnsignedTx))
      case "U":
        return this.client.uChain.issueTx(await this.signU(prepared.unsigned as uchain.UnsignedTx))
    }
  }

  /** Waits until a transaction is accepted (V, U atomic) or committed (M); throws if rejected. */
  async waitForAcceptance(chain: Chain, txID: string, timeoutMs = 60_000): Promise<void> {
    const end = Date.now() + timeoutMs
    for (;;) {
      let status: string
      if (chain === "V") status = await this.client.vChain.getTxStatus(txID)
      else if (chain === "U") status = await this.client.uChain.getAtomicTxStatus(txID)
      else {
        const r: any = await this.client.mChain.getTxStatus(txID)
        status = typeof r === "string" ? r : r.status
        if (status === "Dropped" || status === "Aborted") throw new DijetsTxError(`${txID} was ${status.toLowerCase()}: ${r.reason ?? ""}`)
      }
      if (status === "Accepted" || status === "Committed") return
      if (status === "Rejected") throw new DijetsTxError(`${txID} was rejected`)
      if (Date.now() > end) throw new DijetsTxError(`${txID} not accepted within ${timeoutMs} ms (last status ${status})`)
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  /** prepareSend + submit + waitForAcceptance. */
  async send(req: { to: string; amount: bigint; assetID?: string; memo?: string }): Promise<string> {
    const txID = await this.submit(await this.prepareSend(req))
    await this.waitForAcceptance("V", txID)
    return txID
  }

  // ---- U-Chain EVM ----------------------------------------------------------

  /** An ethers provider for the U-Chain. */
  evmProvider(): ethers.providers.StaticJsonRpcProvider {
    return new ethers.providers.StaticJsonRpcProvider(this.client.uChainRpcUrl, Number(this.client.network.chains.U.evmChainID))
  }

  /**
   * Signs and sends an EVM transaction from the wallet's U-Chain account and
   * waits for its receipt. Nonce, gas and fees are filled in if missing.
   */
  async sendEvm(tx: { to: string; value?: bigint; data?: string; gasLimit?: bigint }): Promise<ethers.providers.TransactionReceipt> {
    this.requireSigning("Sending an EVM transaction")
    const provider = this.evmProvider()
    const from = this.getEvmAddress()
    const to = (await this.resolveRecipient(tx.to, "U")).address
    const feeData = await provider.getFeeData()
    const request: ethers.providers.TransactionRequest = {
      type: 2,
      chainId: Number(this.client.network.chains.U.evmChainID),
      from,
      to,
      value: tx.value === undefined ? undefined : ethers.BigNumber.from(tx.value.toString()),
      data: tx.data,
      nonce: await provider.getTransactionCount(from, "pending"),
      maxFeePerGas: feeData.maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined
    }
    request.gasLimit = tx.gasLimit !== undefined ? ethers.BigNumber.from(tx.gasLimit.toString()) : await provider.estimateGas(request)
    const raw = await this.signEvm(request)
    const sent = await provider.sendTransaction(raw)
    return sent.wait()
  }

  /** ERC-20 transfer on the U-Chain. `amount` is in the token's smallest unit. */
  sendErc20(token: string, to: string, amount: bigint): Promise<ethers.providers.TransactionReceipt> {
    const data = new ethers.utils.Interface(["function transfer(address,uint256) returns (bool)"]).encodeFunctionData("transfer", [to, amount.toString()])
    return this.sendEvm({ to: token, data })
  }

  /** ERC-721 transfer on the U-Chain. */
  sendErc721(token: string, to: string, tokenId: bigint): Promise<ethers.providers.TransactionReceipt> {
    const data = new ethers.utils.Interface(["function safeTransferFrom(address,address,uint256)"]).encodeFunctionData("safeTransferFrom", [this.getEvmAddress(), to, tokenId.toString()])
    return this.sendEvm({ to: token, data })
  }

  // ---- cross-chain --------------------------------------------------------

  private chainID(c: Chain): string {
    if (c === "M") return this.client.network.chains.M.id
    const id = c === "V" ? this.client.network.chains.V.id : this.client.network.chains.U.id
    if (typeof id !== "string") throw new DijetsUnsupportedError(`${c}-Chain ID unknown: connect the client first`)
    return id
  }

  /** The atomic fee in nDJT for a U-Chain import or export at the current base fee, rounded up. */
  private async uAtomicFee(gas: number): Promise<BN> {
    const baseFee = await this.client.uChainEvm.baseFee()
    return bn((baseFee * BigInt(gas) + 999_999_999n) / 1_000_000_000n)
  }

  /** Exports `amount` nDJT from one chain to another (step 1 of a move). */
  async prepareExport(from: Chain, to: Chain, amount: bigint): Promise<PreparedTx> {
    if (from === to) throw new DijetsTxError("Source and destination chains are the same")
    const dest = this.chainID(to)
    const toAddr = to === "U" ? this.getUAtomicAddress() : this.getAddress(to)
    let unsigned: any
    let fee = this.client.network.fees.txFee
    if (from === "V") {
      unsigned = await this.client.vChain.buildExportTx(await this.getUtxos("V"), bn(amount), dest, [toAddr], this.getAddresses("V"), [this.getChangeAddress()])
    } else if (from === "M") {
      unsigned = await this.client.mChain.buildExportTx(await this.getUtxos("M"), bn(amount), dest, [toAddr], this.getAddresses("M"), [this.getAddress("M")])
    } else {
      const nonce = await this.client.uChainEvm.getTransactionCount(this.getEvmAddress())
      // Gas of a single-input, single-output atomic export (coreth: base cost + bytes + one signature), with margin.
      const feeBN = await this.uAtomicFee(12_000)
      fee = big(feeBN)
      unsigned = await this.client.uChain.buildExportTx(bn(amount), this.client.network.djtAssetID as string, dest, this.getEvmAddress(), this.getUAtomicAddress(), [toAddr], nonce, new BN(0), 1, feeBN)
    }
    return { chain: from, description: `Export ${formatDJT(amount)} DJT from the ${from}-Chain to the ${to}-Chain (${toAddr})`, fee, unsigned }
  }

  /** Imports every pending atomic UTXO from `from` into `into` (step 2 of a move). Undefined if none. */
  async prepareImport(into: Chain, from: Chain): Promise<PreparedTx | undefined> {
    const source = this.chainID(from)
    let unsigned: any
    let fee = this.client.network.fees.txFee
    if (into === "V") {
      const atomic = await this.getUtxos("V", from)
      if (!atomic.getAllUTXOs().length) return undefined
      unsigned = await this.client.vChain.buildImportTx(atomic, this.getAddresses("V"), source, [this.getAddress("V")], this.getAddresses("V"))
    } else if (into === "M") {
      const atomic = await this.getUtxos("M", from)
      if (!atomic.getAllUTXOs().length) return undefined
      unsigned = await this.client.mChain.buildImportTx(atomic, this.getAddresses("M"), source, [this.getAddress("M")], this.getAddresses("M"))
    } else {
      const res = await this.client.uChain.getUTXOs([this.getUAtomicAddress()], source)
      if (!res.utxos.getAllUTXOs().length) return undefined
      const feeBN = await this.uAtomicFee(12_000)
      fee = big(feeBN)
      unsigned = await this.client.uChain.buildImportTx(res.utxos, this.getEvmAddress(), [this.getUAtomicAddress()], source, [this.getUAtomicAddress()], feeBN)
    }
    return { chain: into, description: `Import pending DJT from the ${from}-Chain into the ${into}-Chain`, fee, unsigned }
  }

  /** Moves DJT between chains: export, wait, import, wait. */
  async moveDJT(from: Chain, to: Chain, amount: bigint): Promise<{ exportTxID: string; importTxID: string }> {
    const exportTxID = await this.submit(await this.prepareExport(from, to, amount))
    await this.waitForAcceptance(from, exportTxID)
    const imp = await this.prepareImport(to, from)
    if (!imp) throw new DijetsTxError(`The export ${exportTxID} was accepted but nothing is importable on the ${to}-Chain yet`)
    const importTxID = await this.submit(imp)
    await this.waitForAcceptance(to, importTxID)
    return { exportTxID, importTxID }
  }

  // ---- staking (M-Chain) ----------------------------------------------------

  /**
   * Adds a primary-network validator (Apricot AddValidatorTx, accepted on
   * every Dijets network). `delegationFee` is a percentage, ≥ 2.
   */
  async prepareValidate(req: { nodeID: string; amount: bigint; start: bigint; end: bigint; delegationFee: number; rewardAddress?: string }): Promise<PreparedTx> {
    const s = this.client.network.staking
    if (req.amount < s.minValidatorStake) throw new DijetsTxError(`The minimum validator stake is ${s.minValidatorStake} nDJT`)
    if (req.delegationFee * 10_000 < s.minDelegationFee) throw new DijetsTxError(`The minimum delegation fee is ${s.minDelegationFee / 10_000}%`)
    const reward = req.rewardAddress ?? this.getAddress("M")
    const unsigned = await this.client.mChain.buildAddValidatorTx(
      await this.getUtxos("M"), [this.getAddress("M")], this.getAddresses("M"), [this.getAddress("M")],
      req.nodeID, bn(req.start), bn(req.end), bn(req.amount), [reward], req.delegationFee
    )
    return { chain: "M", description: `Validate with ${req.nodeID}, staking ${formatDJT(req.amount)} DJT`, fee: 0n, unsigned }
  }

  async prepareDelegate(req: { nodeID: string; amount: bigint; start: bigint; end: bigint; rewardAddress?: string }): Promise<PreparedTx> {
    const s = this.client.network.staking
    if (req.amount < s.minDelegatorStake) throw new DijetsTxError(`The minimum delegation is ${s.minDelegatorStake} nDJT`)
    const reward = req.rewardAddress ?? this.getAddress("M")
    const unsigned = await this.client.mChain.buildAddDelegatorTx(
      await this.getUtxos("M"), [this.getAddress("M")], this.getAddresses("M"), [this.getAddress("M")],
      req.nodeID, bn(req.start), bn(req.end), bn(req.amount), [reward]
    )
    return { chain: "M", description: `Delegate ${formatDJT(req.amount)} DJT to ${req.nodeID}`, fee: 0n, unsigned }
  }

  // ---- NFTs (V-Chain) -------------------------------------------------------

  /** A new NFT family with `groups` groups, mintable by this wallet. */
  async prepareCreateNftFamily(req: { name: string; symbol: string; groups: number }): Promise<PreparedTx> {
    const minter = [utils.Buffer.from(parseAddress(this.getAddress("V")).bytes)]
    const sets = Array.from({ length: req.groups }, () => new vchain.MinterSet(1, minter))
    const unsigned = await this.client.vChain.buildCreateNFTAssetTx(await this.getUtxos("V"), this.getAddresses("V"), [this.getChangeAddress()], sets, req.name, req.symbol)
    return { chain: "V", description: `Create NFT family ${req.name} (${req.symbol}) with ${req.groups} groups`, fee: this.client.network.fees.createAssetTxFee, unsigned }
  }

  /** Mints one NFT of a family this wallet can mint. */
  async prepareMintNft(req: { familyAssetID: string; groupID?: number; payload: Uint8Array; to?: string }): Promise<PreparedTx> {
    const utxos = await this.getUtxos("V")
    const mintUtxo = utxos.getAllUTXOs().find(
      (u: any) => utils.BinTools.getInstance().cb58Encode(u.getAssetID()) === req.familyAssetID && u.getOutput().getOutputID() === vchain.AVMConstants.NFTMINTOUTPUTID && (u.getOutput() as any).getGroupID() === (req.groupID ?? 0)
    )
    if (!mintUtxo) throw new DijetsTxError(`This wallet holds no minting right for group ${req.groupID ?? 0} of ${req.familyAssetID}`)
    const to = req.to ? (await this.resolveRecipient(req.to, "V")).address : this.getAddress("V")
    const owners = new common.OutputOwners([utils.Buffer.from(parseAddress(to).bytes)], new BN(0), 1)
    const unsigned = await this.client.vChain.buildCreateNFTMintTx(
      utxos, [owners], this.getAddresses("V"), [this.getChangeAddress()], mintUtxo.getUTXOID(), req.groupID ?? 0, utils.Buffer.from(req.payload)
    )
    return { chain: "V", description: `Mint an NFT of ${req.familyAssetID} to ${to}`, fee: this.client.network.fees.txFee, unsigned }
  }

  // ---- names --------------------------------------------------------------

  /**
   * Registers a name pointing at this wallet's V-Chain address and owned by
   * its M-Chain address. The wallet pays the fee and gives the target consent.
   */
  async prepareRegisterName(req: { name: string; expiry: bigint }): Promise<PreparedTx> {
    const params = await this.client.names.params()
    if (!params.active) throw new DijetsUnsupportedError(`The name registry is not active on ${this.client.network.name}`)
    const name = canonicaliseName(req.name)
    const unsigned = await this.client.mChain.buildRegisterNameTx(await this.getUtxos("M"), this.getAddresses("M"), [this.getAddress("M")], {
      name,
      target: this.getAddress("V"),
      owner: { addresses: [this.getAddress("M")] },
      expiry: req.expiry,
      registerFee: params.registerFee
    })
    return { chain: "M", description: `Register "${name}" → ${this.getAddress("V")} until ${new Date(Number(req.expiry) * 1000).toISOString()}`, fee: params.registerFee, unsigned }
  }

  /** Renews a name this wallet owns. */
  async prepareRenewName(name: string, expiry: bigint): Promise<PreparedTx> {
    const params = await this.client.names.params()
    const r = await this.client.names.resolve(canonicaliseName(name))
    if (!r.record) throw new DijetsTxError(`"${name}" is not registered`)
    const unsigned = await this.client.mChain.buildUpdateNameTx(await this.getUtxos("M"), this.getAddresses("M"), [this.getAddress("M")], r.record, this.getAddresses("M"), {
      expiry,
      updateFee: params.updateFee
    })
    return { chain: "M", description: `Renew "${r.name}" until ${new Date(Number(expiry) * 1000).toISOString()}`, fee: params.updateFee, unsigned }
  }

  /** The name that points at this wallet's current V-Chain address, if any. */
  async getName(): Promise<string | undefined> {
    return (await this.client.names.reverse(this.getAddress("V"))).name
  }

  // ---- Arcs ---------------------------------------------------------------

  /**
   * This wallet on an Arc's chain: the same keys, addressed with the Arc's
   * chain ID. Fees are paid in the Arc's own fee asset.
   */
  arc(chainID: string, feeAssetID: string): ArcWallet {
    return new ArcWallet(this, chainID, feeAssetID)
  }

  /** @internal used by ArcWallet. */
  _signArc(tx: vchain.UnsignedTx): Promise<vchain.Tx> {
    return this.signV(tx)
  }

  // ---- history ------------------------------------------------------------

  /**
   * Recent transactions touching the wallet's current addresses, from the
   * explorer (an optional service: configure `explorerUrl` on the client).
   */
  async getHistory(limit = 50): Promise<any[]> {
    const ex = this.client.explorer
    const addrs = [...new Set([...this.getAddresses("V"), ...this.getAddresses("M").map((a) => a), this.getEvmAddress()])]
    const pages = await Promise.all(addrs.map((a) => ex.addressTxs(a, { limit }).then((r) => r.data as any[]).catch(() => [])))
    const seen = new Set<string>()
    return pages.flat().filter((t: any) => !seen.has(t.id) && seen.add(t.id))
  }

  // ---- presentation -------------------------------------------------------

  toJSON(): object {
    return { kind: this.kind, network: this.client.network.key, V: this.getAddress("V"), M: this.getAddress("M"), U: this.getEvmAddress() }
  }
  [inspect](): string {
    return `${this.constructor.name} ${JSON.stringify(this.toJSON())}`
  }
}

/** A wallet on one Arc's AVM chain. */
export class ArcWallet {
  constructor(
    readonly wallet: Wallet,
    readonly chainID: string,
    readonly feeAssetID: string
  ) {}

  private api() {
    return this.wallet.client.arcChain(this.chainID, { feeAssetID: this.feeAssetID }) as any
  }
  private addr(a: string): string {
    const p = parseAddress(a)
    return formatAddress(this.chainID, p.hrp, p.bytes)
  }
  getAddress(): string {
    return this.addr(this.wallet.getAddress("V"))
  }
  getAddresses(): string[] {
    return this.wallet.getAddresses("V").map((a) => this.addr(a))
  }

  async getBalance(assetID: string = this.feeAssetID): Promise<bigint> {
    const set = (await this.api().getUTXOs(this.getAddresses())).utxos
    let total = 0n
    for (const u of set.getAllUTXOs()) {
      if (utils.BinTools.getInstance().cb58Encode(u.getAssetID()) !== assetID) continue
      const out: any = u.getOutput()
      if (typeof out.getAmount === "function" && big(out.getLocktime()) <= now()) total += big(out.getAmount())
    }
    return total
  }

  /** Sends an asset on the Arc. The recipient may be a V-Chain address, a name, or an address on this Arc. */
  async send(req: { to: string; amount: bigint; assetID?: string }): Promise<string> {
    const target = req.to.startsWith(`${this.chainID}-`) ? req.to : (await this.wallet.resolveRecipient(req.to, "V")).address
    const api = this.api()
    const set = (await api.getUTXOs(this.getAddresses())).utxos
    const unsigned = await api.buildBaseTx(set, bn(req.amount), req.assetID ?? this.feeAssetID, [this.addr(target)], this.getAddresses(), [this.addr(this.wallet.getChangeAddress())])
    const txID = await api.issueTx(await this.wallet._signArc(unsigned))
    for (let i = 0; i < 120; i++) {
      const s = await api.getTxStatus(txID)
      if (s === "Accepted") return txID
      if (s === "Rejected") throw new DijetsTxError(`${txID} was rejected`)
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new DijetsTxError(`${txID} not accepted in time`)
  }
}

