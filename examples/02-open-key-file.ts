// OFFLINE. Open a key file (versions 2.0–6.0) and show its wallets' addresses.
//   KEYFILE=my-wallet.json KEYFILE_PASSWORD=… npx tsx examples/02-open-key-file.ts
import { readFileSync } from "node:fs"
import { openKeyFile, KeystoreError } from "@dijets/wallet-sdk"
import { offlineClient } from "./_config"

async function main() {
  const file = JSON.parse(readFileSync(process.env.KEYFILE ?? "my-wallet.json", "utf8"))
  try {
    const { wallets, activeIndex } = await openKeyFile(offlineClient(), file, process.env.KEYFILE_PASSWORD ?? "")
    wallets.forEach((w, i) => console.log(`${i === activeIndex ? "*" : " "} ${w.kind}: ${w.getAddress("V")}  ${w.getEvmAddress()}`))
  } catch (e) {
    if (e instanceof KeystoreError) console.log("Cannot open:", e.reason)
    else throw e
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })
