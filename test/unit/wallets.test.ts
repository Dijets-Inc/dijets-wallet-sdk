import util from "node:util"
import { DijetsClient, MAINNET, withOverrides, DijetsUnsupportedError, parseAddress, vchain, utils } from "@dijets/platform-js"
import * as bip39 from "bip39"
import BN from "bn.js"
import { MnemonicWallet, ReadOnlyWallet, SingletonWallet, verifyMessage, LedgerWallet, type LedgerAvaxApp, type LedgerEthApp } from "../../src"
import wallet from "../vectors/wallet.json"
import messages from "../vectors/messages.json"
import platformAddresses from "../vectors/platform-addresses.json"

// Offline mainnet client (HRP "dijets"): no request is made in these tests.
const calls: string[] = []
const noNetwork = (async (url: string) => {
  calls.push(url)
  throw new Error("no network in unit tests")
}) as unknown as typeof fetch
const client = new DijetsClient({
  network: withOverrides(MAINNET, { chains: { U: { id: "vWaU1HuvgqAQ9KkKSh5ThrxXvSCZ2ZDK1k8zeg2innRv2SdrN" } } }),
  url: "http://127.0.0.1:1",
  fetch: noNetwork
})

describe("MnemonicWallet derives the web wallet's addresses", () => {
  const w = MnemonicWallet.fromMnemonic(client, wallet.mnemonic)

  test("first receive, change, M-Chain, EVM and U-atomic addresses", () => {
    expect(w.getAddress("V")).toBe(wallet.external[0])
    expect(w.getAddress("M")).toBe(wallet.external[0].replace(/^V-/, "M-"))
    expect(w.getChangeAddress()).toBe(wallet.internal[0])
    expect(w.getEvmAddress()).toBe(wallet.evmAddress)
    expect(w.getUAtomicAddress()).toBe(wallet.uAtomicAddress)
  })

  test("every external and internal address in upstream's vectors", () => {
    w.receive.setIndex(wallet.external.length - 1)
    w.change.setIndex(wallet.internal.length - 1)
    expect(w.getAddresses("V")).toEqual([...wallet.external, ...wallet.internal])
    expect(w.getAddresses("M")).toEqual(wallet.external.map((a: string) => a.replace(/^V-/, "M-")))
    w.receive.setIndex(0)
    w.change.setIndex(0)
  })

  test("its xpubs are upstream's", () => {
    expect(w.getXpub()).toBe(wallet.xpub)
    expect(w.getEvmXpub()).toBe(wallet.evmAccountXpub)
  })

  test("rejects an invalid mnemonic", () => {
    expect(() => MnemonicWallet.fromMnemonic(client, "not a real mnemonic")).toThrow(/Invalid mnemonic/)
  })
})

describe("ReadOnlyWallet", () => {
  test("from the account-level or address-level EVM xpub, the same addresses", () => {
    for (const evm of [wallet.evmAccountXpub, wallet.evmAddressXpub]) {
      const r = ReadOnlyWallet.fromXpub(client, wallet.xpub, evm)
      expect(r.getAddress("V")).toBe(wallet.external[0])
      expect(r.getChangeAddress()).toBe(wallet.internal[0])
      expect(r.getEvmAddress()).toBe(wallet.evmAddress)
      expect(r.getUAtomicAddress()).toBe(wallet.uAtomicAddress)
    }
  })
  test("cannot sign", async () => {
    const r = ReadOnlyWallet.fromXpub(client, wallet.xpub, wallet.evmAccountXpub)
    expect(r.capabilities.sign).toBe(false)
    await expect(r.submit({ chain: "V", description: "", fee: 0n, unsigned: {} as any })).rejects.toBeInstanceOf(DijetsUnsupportedError)
    await expect(r.sendEvm({ to: wallet.evmAddress })).rejects.toBeInstanceOf(DijetsUnsupportedError)
  })
})

describe("SingletonWallet", () => {
  test("one key on every chain, as the node formats it", () => {
    const ewoq = platformAddresses.addresses.filter((a: any) => a.privateKey.includes("ewoq") && a.hrp === "dijets")
    const s = SingletonWallet.fromPrivateKey(client, ewoq[0].privateKey)
    expect(s.getAddress("V")).toBe(ewoq.find((a: any) => a.chain === "V").address)
    expect(s.getAddress("M")).toBe(ewoq.find((a: any) => a.chain === "M").address)
    expect(s.getEvmAddress()).toBe("0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC")
    // The same 32 bytes as hex.
    const hex = SingletonWallet.fromPrivateKey(client, "0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027")
    expect(hex.getAddress("V")).toBe(s.getAddress("V"))
  })
})

describe("message signing matches the unmodified upstream library", () => {
  const w = MnemonicWallet.fromMnemonic(client, wallet.mnemonic)
  test.each(messages.map((m: any) => [m.message.length, m] as const))("message of %i bytes", (_n, m: any) => {
    expect(w.signMessage(m.message, 0)).toBe(m.signature)
    expect(verifyMessage(m.message, m.signature, "dijets")).toBe(wallet.external[0])
  })
})

describe("secrets never leak", () => {
  const w = MnemonicWallet.fromMnemonic(client, wallet.mnemonic)
  const s = SingletonWallet.fromPrivateKey(client, "PrivateKey-ewoqjP7PxY4yr3iLTpLisriqt94hdyDFNgchSxGGztUrTXtNN")
  test("not in JSON, inspection or string conversion", () => {
    for (const x of [w, s]) {
      const shown = [JSON.stringify(x), util.inspect(x, { depth: 10 }), String(x), util.format("%o", x)].join("\n")
      expect(shown).not.toContain("chimney")
      expect(shown).not.toContain("ewoqjP7P")
      expect(shown).not.toMatch(/0x[0-9a-f]{64}/)
    }
  })
  test("wipe() removes them", () => {
    const x = MnemonicWallet.fromMnemonic(client, wallet.mnemonic)
    x.wipe()
    expect(() => x.getMnemonic()).toThrow(/wiped/)
    expect(() => x.getEvmAddress()).toThrow(/wiped/)
  })
})

describe("recipients", () => {
  const w = SingletonWallet.fromPrivateKey(client, "PrivateKey-ewoqjP7PxY4yr3iLTpLisriqt94hdyDFNgchSxGGztUrTXtNN")
  const v = w.getAddress("V")
  test("an address is checked for chain and network", async () => {
    expect((await w.resolveRecipient(v, "V")).address).toBe(v)
    await expect(w.resolveRecipient(w.getAddress("M"), "V")).rejects.toThrow(/is a M-Chain address; expected V/)
    const lothar = platformAddresses.addresses.find((a: any) => a.hrp === "lothar" && a.chain === "V").address
    await expect(w.resolveRecipient(lothar, "V")).rejects.toThrow(/is for network "lothar"/)
  })
  test("U-Chain recipients are EVM addresses; names cannot point at them", async () => {
    expect((await w.resolveRecipient("0x8db97c7cece249c2b98bdc0226cc4c2a57bf52fc", "U")).address).toBe("0x8db97C7cEcE249c2b98bDC0226Cc4C2A57BF52FC")
    await expect(w.resolveRecipient("alice", "U")).rejects.toBeInstanceOf(DijetsUnsupportedError)
  })
  test("an invalid name is refused before any request", async () => {
    const before = calls.length
    await expect(w.resolveRecipient("v-alice", "V")).rejects.toMatchObject({ rule: "chain_prefix" })
    expect(calls.length).toBe(before)
  })
})

describe("wallet patch regressions", () => {
  test("#11 chain detection: V-, M-, U- (bech32) and 0x are distinguished", async () => {
    const w = SingletonWallet.fromPrivateKey(client, "PrivateKey-ewoqjP7PxY4yr3iLTpLisriqt94hdyDFNgchSxGGztUrTXtNN")
    await expect(w.resolveRecipient(w.getUAtomicAddress(), "V")).rejects.toThrow(/U-Chain address/)
    await expect(w.resolveRecipient(w.getEvmAddress(), "V")).rejects.toThrow(/EVM address/)
  })
  test("#12 creating wallets makes no network request", () => {
    const before = calls.length
    MnemonicWallet.create(client)
    ReadOnlyWallet.fromXpub(client, wallet.xpub, wallet.evmAccountXpub)
    expect(calls.length).toBe(before)
  })
})

// A mock Ledger whose keys are the test mnemonic's, signing like the device
// (65-byte recoverable signatures over the transaction hash).
function mockLedger(): { avax: LedgerAvaxApp; eth: LedgerEthApp } {
  const seed = bip39.mnemonicToSeedSync(wallet.mnemonic)
  const master = new utils.HDNode(utils.Buffer.from(seed))
  return {
    avax: {
      async getWalletExtendedPublicKey(path: string) {
        const n = master.derive(path)
        return { public_key: n.publicKey, chain_code: n.chainCode }
      },
      async signHash(root: any, suffixes: any[], hash: Uint8Array) {
        const out = new Map<string, Uint8Array>()
        for (const s of suffixes) {
          const suffix = s.toString(true)
          const node = master.derive(`${root.toString()}/${suffix}`)
          out.set(suffix, new vchain.KeyChain("dijets", "V").importKey(node.privateKeyCB58).sign(utils.Buffer.from(hash)))
        }
        return out
      }
    },
    eth: {
      async getAddress(path: string) {
        const n = master.derive(`m/${path.replace(/^m\//, "")}`)
        return { publicKey: n.publicKey.toString("hex"), chainCode: n.chainCode.toString("hex") }
      },
      async signTransaction() {
        throw new Error("not used")
      }
    }
  }
}

describe("LedgerWallet (experimental, mock device)", () => {
  test("must be acknowledged as experimental", async () => {
    await expect(LedgerWallet.connect(client, { apps: mockLedger(), acknowledgeExperimental: false })).rejects.toThrow(/experimental/)
  })

  test("derives the same addresses as the mnemonic wallet", async () => {
    const l = await LedgerWallet.connect(client, { apps: mockLedger(), acknowledgeExperimental: true })
    expect(l.capabilities).toMatchObject({ hardware: true, experimental: true, sign: true })
    expect(l.getAddress("V")).toBe(wallet.external[0])
    expect(l.getEvmAddress()).toBe(wallet.evmAddress)
  })

  test("signs a V-Chain transfer exactly as the mnemonic wallet does", async () => {
    const l = await LedgerWallet.connect(client, { apps: mockLedger(), acknowledgeExperimental: true })
    const m = MnemonicWallet.fromMnemonic(client, wallet.mnemonic)
    const asset = utils.BinTools.getInstance().cb58Decode(MAINNET.djtAssetID as string)
    const owner = utils.Buffer.from(parseAddress(wallet.external[0]).bytes)
    const utxos = new vchain.UTXOSet()
    utxos.add(new vchain.UTXO(0, utils.Buffer.alloc(32, 7), 0, asset, new vchain.SECPTransferOutput(new BN(5_000_000_000), [owner], new BN(0), 1)))
    const unsigned = await client.vChain.buildBaseTx(utxos, new BN(1_000_000_000), MAINNET.djtAssetID as string, [wallet.external[1]], [wallet.external[0]], [wallet.internal[0]])
    const fromLedger = await (l as any).signV(unsigned)
    const fromMnemonic = await (m as any).signV(unsigned)
    expect(fromLedger.toBuffer().toString("hex")).toBe(fromMnemonic.toBuffer().toString("hex"))
  })

  test("refuses name, subnet and Arc transactions", async () => {
    const l = await LedgerWallet.connect(client, { apps: mockLedger(), acknowledgeExperimental: true })
    const fake: any = { getTransaction: () => ({ getTxType: () => 33 }) }
    await expect((l as any).signM(fake)).rejects.toThrow(/not name, subnet or Arc/)
  })
})
