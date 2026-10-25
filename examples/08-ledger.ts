// EXPERIMENTAL, UNTESTED ON A DEVICE. Open a Ledger with the Avalanche app (hash signing enabled).
//   npm install @ledgerhq/hw-transport-node-hid @obsidiansystems/hw-app-avalanche @ledgerhq/hw-app-eth
//   npx tsx examples/08-ledger.ts
import { LedgerWallet } from "@dijets/wallet-sdk"
import { connect } from "./_config"

async function main() {
  const client = await connect()
  const TransportNodeHid = (await import("@ledgerhq/hw-transport-node-hid" as string)).default
  const transport = await TransportNodeHid.create()
  // Signing is blind (the device shows a hash) and Dijets addresses cannot be shown on the device.
  const wallet = await LedgerWallet.connect(client, { transport, acknowledgeExperimental: true })
  await wallet.scan()
  console.log("V-Chain", wallet.getAddress("V"), "· U-Chain", wallet.getEvmAddress())
}
main().catch((e) => { console.error(e.message); process.exit(1) })
