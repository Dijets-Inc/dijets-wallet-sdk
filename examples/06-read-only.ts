// READ-ONLY. Watch a wallet from its xpubs without holding any key.
//   XPUB=xpub… EVM_XPUB=xpub… npx tsx examples/06-read-only.ts
import { formatDJT } from "@dijets/platform-js"
import { ReadOnlyWallet } from "@dijets/wallet-sdk"
import { connect } from "./_config"

async function main() {
  const client = await connect()
  const xpub = process.env.XPUB
  const evm = process.env.EVM_XPUB
  if (!xpub || !evm) throw new Error("Set XPUB (m/44'/9000'/0') and EVM_XPUB (m/44'/60'/0'), e.g. from MnemonicWallet.getXpub()/getEvmXpub()")
  const wallet = ReadOnlyWallet.fromXpub(client, xpub, evm)
  await wallet.scan()
  console.log("receive address", wallet.getAddress("V"), "· can sign:", wallet.capabilities.sign)
  console.log("V DJT", formatDJT(await wallet.getDJTBalance("V")))
}
main().catch((e) => { console.error(e.message); process.exit(1) })
