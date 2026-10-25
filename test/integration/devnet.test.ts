/**
 * Wallet integration tests against a real node; nothing is mocked. Every
 * transaction is built, signed here and accepted by consensus.
 *
 *   DIJETS_NODE_URL=http://127.0.0.1:19750 npm run test:integration
 *
 * Start a network with the node's harness (dijetsnodesgo):
 *   NAMES_DEVNET=1 NAMES_DEVNET_HOLD=60m go test -tags names_e2e -timeout 0 -run TestDevNetwork ./tests/names/
 * The ewoq test key is funded there; only test keys are used.
 */
import { DijetsClient, defineNetwork, DJT, DijetsUnsupportedError, DijetsConfigError } from "@dijets/platform-js"
import { MnemonicWallet, SingletonWallet, ReadOnlyWallet, openKeyFile } from "../../src"

const URL_ = process.env.DIJETS_NODE_URL
const run = URL_ ? describe : describe.skip
const EWOQ = "PrivateKey-ewoqjP7PxY4yr3iLTpLisriqt94hdyDFNgchSxGGztUrTXtNN"
const nowS = () => BigInt(Math.floor(Date.now() / 1000))

run("wallets against a live node", () => {
  let client: DijetsClient
  let funder: SingletonWallet
  let alice: MnemonicWallet
  let bob: MnemonicWallet

  beforeAll(async () => {
    client = await DijetsClient.connect({ network: defineNetwork({ networkID: Number(process.env.DIJETS_NETWORK_ID ?? 1337), nodeUrl: URL_! }) })
    funder = SingletonWallet.fromPrivateKey(client, EWOQ)
    alice = MnemonicWallet.create(client)
    bob = MnemonicWallet.create(client)
  })

  test("fund, scan and read balances", async () => {
    const to = alice.getAddress("V")
    await funder.send({ to, amount: 60n * DJT })
    await funder.send({ to: bob.getAddress("V"), amount: 5n * DJT })
    // After receiving at index 0, a scan moves the receive address on.
    expect(await alice.scan()).toEqual({ receive: 1, change: 0 })
    expect(alice.getAddresses("V")).toContain(to)
    const b = await alice.getBalance()
    expect(b.V[client.network.djtAssetID as string].unlocked).toBe(60n * DJT)
    expect(await alice.getDJTBalance("V")).toBe(60n * DJT)
  })

  test("V → M atomic transfer, with change returned to the HD wallet", async () => {
    const r = await alice.moveDJT("V", "M", 30n * DJT)
    expect(r.exportTxID).toBeTruthy()
    expect(await alice.getDJTBalance("M")).toBe(30n * DJT - client.network.fees.txFee)
    expect(await alice.getDJTBalance("V")).toBe(30n * DJT - client.network.fees.txFee)
  })

  test("V → U → V through atomic transfers, and an EVM transfer", async () => {
    await alice.moveDJT("V", "U", 5n * DJT)
    const wei = (await alice.getBalance()).U
    expect(wei).toBeGreaterThan(4n * DJT * 1_000_000_000n)
    const receipt = await alice.sendEvm({ to: "0x000000000000000000000000000000000000dEaD", value: 10n ** 17n })
    expect(receipt.status).toBe(1)
    const before = await alice.getDJTBalance("V")
    await alice.moveDJT("U", "V", 1n * DJT)
    expect(await alice.getDJTBalance("V")).toBe(before + DJT - client.network.fees.txFee)
  })

  test("register a name, then another wallet pays it by name", async () => {
    const name = `w${Date.now().toString(36)}`
    const target = alice.getAddress("V")
    const prepared = await alice.prepareRegisterName({ name, expiry: nowS() + 30n * 24n * 3600n })
    expect(prepared.description).toContain(name)
    await alice.waitForAcceptance("M", await alice.submit(prepared))
    expect(await alice.getName()).toBe(name)

    const before = (await client.vChain.getDJTBalance(target))
    const pay = await bob.prepareSend({ to: name.toUpperCase(), amount: DJT })
    expect(pay.recipient).toMatchObject({ address: target, name: { name } })
    await bob.waitForAcceptance("V", await bob.submit(pay))
    expect(await client.vChain.getDJTBalance(target)).toBe(before + DJT)

    await alice.waitForAcceptance("M", await alice.submit(await alice.prepareRenewName(name, nowS() + 60n * 24n * 3600n)))
    expect((await client.names.resolve(name)).record!.version).toBe(2n)
  })

  test("delegate to a validator", async () => {
    const nodeID = await client.info.getNodeID()
    const v: any = await client.mChain.getCurrentValidators()
    const me = v.validators.find((x: any) => x.nodeID === nodeID)
    const start = nowS() + 60n
    const end = BigInt(Math.min(Number(me.endTime) - 60, Number(start) + client.network.staking.minStakeDuration + 3600))
    const p = await alice.prepareDelegate({ nodeID, amount: 25n * DJT, start, end })
    await alice.waitForAcceptance("M", await alice.submit(p))
    const stake: any = await client.mChain.getStake(alice.getAddresses("M"))
    expect(BigInt(stake.staked.toString())).toBe(25n * DJT)
  })

  test("create an NFT family and mint one", async () => {
    const fam = await alice.prepareCreateNftFamily({ name: "Dijets Test", symbol: "DTST", groups: 1 })
    const familyID = await alice.submit(fam)
    await alice.waitForAcceptance("V", familyID)
    const mint = await alice.prepareMintNft({ familyAssetID: familyID, payload: new TextEncoder().encode("hello") })
    await alice.waitForAcceptance("V", await alice.submit(mint))
    const utxos = await alice.getUtxos("V")
    const nft = utxos.getAllUTXOs().filter((u: any) => u.getOutput().getOutputID() === 11)
    expect(nft.length).toBe(1)
  })

  test("a key file reopens the wallet; a read-only wallet sees it but cannot spend", async () => {
    const file = await alice.exportKeyFile("integration test password")
    const { wallets } = await openKeyFile(client, file, "integration test password")
    const reopened = wallets[0] as MnemonicWallet
    // Both scan: bob's payment used alice's index-1 address, so both move to index 2.
    const [a, b] = await Promise.all([reopened.scan(), alice.scan()])
    expect(a).toEqual(b)
    expect(reopened.getAddress("V")).toBe(alice.getAddress("V"))
    expect(reopened.getAddresses("V")).toEqual(alice.getAddresses("V"))

    const ro = ReadOnlyWallet.fromXpub(client, alice.getXpub(), alice.getEvmXpub())
    await ro.scan()
    expect(await ro.getDJTBalance("V")).toBe(await alice.getDJTBalance("V"))
    await expect(ro.submit(await ro.prepareSend({ to: bob.getAddress("V"), amount: 1n }))).rejects.toBeInstanceOf(DijetsUnsupportedError)
  })

  test("history needs the explorer, which this network does not have", async () => {
    await expect(alice.getHistory()).rejects.toBeInstanceOf(DijetsConfigError)
  })
})
