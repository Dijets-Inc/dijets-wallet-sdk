// OFFLINE. Sign a message (compatible with the Dijets web wallet) and verify it.
//   MNEMONIC="…" MESSAGE="I own this address" npx tsx examples/07-sign-message.ts
import { MnemonicWallet, verifyMessage } from "@dijets/wallet-sdk"
import { offlineClient, requireMnemonic } from "./_config"

const client = offlineClient()
const wallet = MnemonicWallet.fromMnemonic(client, requireMnemonic())
const message = process.env.MESSAGE ?? "I own this address"
const signature = wallet.signMessage(message, 0)
console.log("address  ", wallet.getAddress("V"))
console.log("signature", signature)
console.log("recovers ", verifyMessage(message, signature, client.hrp))
