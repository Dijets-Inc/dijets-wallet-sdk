// READ-ONLY. Scan an HD wallet and show its balances on V, M and U.
//   MNEMONIC="…" npx tsx examples/03-balances.ts
import { formatDJT } from "@dijets/platform-js"
import { MnemonicWallet } from "@dijets/wallet-sdk"
import { connect, requireMnemonic } from "./_config"

async function main() {
  const client = await connect()
  const wallet = MnemonicWallet.fromMnemonic(client, requireMnemonic())
  const { receive, change } = await wallet.scan()
  console.log(`receive index ${receive}, change index ${change}; next address ${wallet.getAddress("V")}`)
  const b = await wallet.getBalance()
  for (const a of Object.values(b.V)) console.log(`V ${a.assetID}: ${formatDJT(a.unlocked)} (${formatDJT(a.locked)} locked)`)
  console.log(`M: ${formatDJT(b.M.unlocked)} unlocked, ${formatDJT(b.M.staked)} staked`)
  console.log(`U: ${formatDJT(b.U, 18)} DJT`)
  console.log("name:", (await wallet.getName()) ?? "(none)")
}
main().catch((e) => { console.error(e.message); process.exit(1) })
