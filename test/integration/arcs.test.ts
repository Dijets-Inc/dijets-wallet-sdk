/**
 * A wallet on an Arc, against the node's Arc development network (see
 * dijets-platform-js/test/integration/arcs.test.ts for how to start it).
 *   DIJETS_ARC_NODE_URL=http://127.0.0.1:19654 npm run test:integration
 */
import { DijetsClient, defineNetwork, utils } from "@dijets/platform-js"
import { SingletonWallet, MnemonicWallet } from "../../src"

const URL_ = process.env.DIJETS_ARC_NODE_URL
const run = URL_ ? describe : describe.skip

run("a wallet on an Arc", () => {
  test("the same keys hold the Arc's asset; a transfer pays the Arc's fee asset", async () => {
    const client = await DijetsClient.connect({ network: defineNetwork({ networkID: 1337, nodeUrl: URL_! }) })
    const alpha = (await client.arcs.listAll({ name: "alpha" }))[0].descriptor.id
    const asset = await (client.arcChain(alpha) as any).getAssetDescription("ARC")
    const feeAssetID = utils.BinTools.getInstance().cb58Encode(asset.assetID)

    const ewoq = SingletonWallet.fromPrivateKey(client, "PrivateKey-ewoqjP7PxY4yr3iLTpLisriqt94hdyDFNgchSxGGztUrTXtNN")
    const onArc = ewoq.arc(alpha, feeAssetID)
    expect(onArc.getAddress()).toBe(`${alpha}-${ewoq.getAddress("V").slice(2)}`)
    const before = await onArc.getBalance()
    expect(before).toBeGreaterThan(0n)

    const bob = MnemonicWallet.create(client)
    // The recipient is given as bob's V-Chain address; the Arc wallet addresses it on the Arc.
    await onArc.send({ to: bob.getAddress("V"), amount: 5_000_000_000n })
    expect(await bob.arc(alpha, feeAssetID).getBalance()).toBe(5_000_000_000n)
    expect(await onArc.getBalance()).toBe(before - 5_000_000_000n - client.network.fees.txFee)
  })
})
