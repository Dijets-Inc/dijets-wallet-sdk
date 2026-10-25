// PREPARE, REVIEW, AND BROADCAST ONLY WHEN ASKED. Send DJT on the V-Chain to an address or a registered name.
//   MNEMONIC="…" TO=alice AMOUNT=1.5 npx tsx examples/04-send.ts
//   MNEMONIC="…" TO=alice AMOUNT=1.5 BROADCAST=1 npx tsx examples/04-send.ts
import { parseDJT, formatDJT } from "@dijets/platform-js"
import { MnemonicWallet } from "@dijets/wallet-sdk"
import { connect, requireMnemonic } from "./_config"

async function main() {
  const client = await connect()
  const wallet = MnemonicWallet.fromMnemonic(client, requireMnemonic())
  await wallet.scan()
  const prepared = await wallet.prepareSend({ to: process.env.TO ?? "alice", amount: parseDJT(process.env.AMOUNT ?? "1") })
  console.log(prepared.description)
  if (prepared.recipient?.name) {
    const n = prepared.recipient.name
    console.log(`  "${n.name}" resolved to ${n.address} (record ${n.recordID}, version ${n.version}, at M-Chain height ${n.at.height})`)
  }
  console.log(`  fee ${formatDJT(prepared.fee)} DJT`)
  if (process.env.BROADCAST !== "1") return console.log("not broadcast (set BROADCAST=1 to submit)")
  const txID = await wallet.submit(prepared)
  await wallet.waitForAcceptance("V", txID)
  console.log("accepted", txID)
}
main().catch((e) => { console.error(e.message); process.exit(1) })
