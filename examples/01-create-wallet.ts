// OFFLINE. Create a wallet and save it as an encrypted key file (web-wallet compatible).
//   KEYFILE_PASSWORD=… npx tsx examples/01-create-wallet.ts > my-wallet.json
import { MnemonicWallet } from "@dijets/wallet-sdk"
import { offlineClient } from "./_config"

async function main() {
  const password = process.env.KEYFILE_PASSWORD
  if (!password || password.length < 12) throw new Error("Set KEYFILE_PASSWORD (12+ characters)")
  const wallet = MnemonicWallet.create(offlineClient())
  console.error("V-Chain:", wallet.getAddress("V"))
  console.error("M-Chain:", wallet.getAddress("M"))
  console.error("U-Chain:", wallet.getEvmAddress())
  // The key file is the backup; the mnemonic itself is never printed.
  process.stdout.write(JSON.stringify(await wallet.exportKeyFile(password), null, 2) + "\n")
  wallet.wipe()
}
main().catch((e) => { console.error(e.message); process.exit(1) })
