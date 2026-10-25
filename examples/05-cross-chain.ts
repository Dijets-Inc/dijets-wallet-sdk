// BROADCAST ONLY WHEN ASKED. Move DJT between chains (export, then import).
//   MNEMONIC="…" FROM=V TO=M AMOUNT=2 BROADCAST=1 npx tsx examples/05-cross-chain.ts
import { parseDJT } from "@dijets/platform-js"
import { MnemonicWallet, type Chain } from "@dijets/wallet-sdk"
import { connect, requireMnemonic } from "./_config"

async function main() {
  const client = await connect()
  const wallet = MnemonicWallet.fromMnemonic(client, requireMnemonic())
  await wallet.scan()
  const from = (process.env.FROM ?? "V") as Chain
  const to = (process.env.TO ?? "M") as Chain
  const amount = parseDJT(process.env.AMOUNT ?? "1")
  const exp = await wallet.prepareExport(from, to, amount)
  console.log(exp.description, "· fee", exp.fee.toString(), "nDJT")
  if (process.env.BROADCAST !== "1") return console.log("not broadcast (set BROADCAST=1 to submit)")
  console.log(await wallet.moveDJT(from, to, amount))
}
main().catch((e) => { console.error(e.message); process.exit(1) })
