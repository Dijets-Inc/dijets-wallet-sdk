import type { DijetsClient } from "@dijets/platform-js"
import { MnemonicWallet } from "../mnemonic"
import { SingletonWallet } from "../singleton"
import { readKeyFile, makeKeyFile, type KeyFile } from "./keystore"

export * from "./keystore"

/**
 * Opens every wallet in a key file (the web wallet's format, 2.0–6.0).
 * Throws `KeystoreError("INVALID_PASSWORD")` for a wrong password.
 */
export async function openKeyFile(
  client: DijetsClient,
  file: unknown,
  password: string
): Promise<{ wallets: (MnemonicWallet | SingletonWallet)[]; activeIndex: number }> {
  const { entries, activeIndex } = await readKeyFile(file, password)
  const wallets = entries.map((e) =>
    e.type === "singleton" ? SingletonWallet.fromPrivateKey(client, e.secret) : MnemonicWallet.fromMnemonic(client, e.secret)
  )
  return { wallets, activeIndex }
}

/** A 6.0 key file holding several wallets. */
export function exportKeyFile(wallets: (MnemonicWallet | SingletonWallet)[], password: string, activeIndex = 0): Promise<KeyFile> {
  return makeKeyFile(
    wallets.map((w) => (w instanceof SingletonWallet ? { type: "singleton" as const, secret: w.getPrivateKey() } : { type: "mnemonic" as const, secret: w.getMnemonic() })),
    password,
    activeIndex
  )
}
