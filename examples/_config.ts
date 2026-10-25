// Shared example configuration from the environment:
//   DIJETS_NETWORK   mainnet | lothar | local | <network ID>   (default local)
//   DIJETS_NODE_URL  node base URL (required for mainnet, Lothar and custom IDs)
//   MNEMONIC         the wallet's mnemonic (never printed)
import { DijetsClient, defineNetwork, networks, type ClientOptions } from "@dijets/platform-js"

export function clientOptions(): ClientOptions {
  const net = process.env.DIJETS_NETWORK ?? "local"
  const url = process.env.DIJETS_NODE_URL
  if (net in networks) return { network: net as keyof typeof networks, url }
  if (!url) throw new Error("Set DIJETS_NODE_URL for a custom network ID")
  return { network: defineNetwork({ networkID: Number(net), nodeUrl: url }) }
}
export const connect = (): Promise<DijetsClient> => DijetsClient.connect(clientOptions())
export const offlineClient = (): DijetsClient => new DijetsClient({ network: "local", url: "http://127.0.0.1:9650" })

export function requireMnemonic(): string {
  const m = process.env.MNEMONIC
  if (!m) throw new Error("Set MNEMONIC (it is read from the environment and never printed)")
  return m
}
