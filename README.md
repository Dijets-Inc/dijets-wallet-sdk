# @dijets/wallet-sdk

Wallets for Dijets, built on [`@dijets/platform-js`](../dijets-platform-js):

- mnemonic (HD), single-key, read-only (xpub) and **experimental** Ledger wallets;
- V-, M- and U-Chain balances, transfers and cross-chain moves;
- staking and NFTs;
- payments to native names;
- Arcs;
- encrypted key files compatible with the Dijets web wallet.

> **Not published.** `"private": true`. It depends on `@dijets/platform-js` by path (`file:../dijets-platform-js`); build that first.

```
Application → @dijets/wallet-sdk → @dijets/platform-js → Dijets node APIs
```

The wallet SDK has no network code of its own. Every node interaction goes through the `DijetsClient` you give it, so one process can hold wallets on several networks.

## Quick start

```ts
import { DijetsClient, parseDJT } from "@dijets/platform-js"
import { MnemonicWallet } from "@dijets/wallet-sdk"

const client = await DijetsClient.connect({ network: "local" })
const wallet = MnemonicWallet.fromMnemonic(client, process.env.MNEMONIC!)
await wallet.scan() // find the addresses already in use (BIP-44 gap of 20)

const prepared = await wallet.prepareSend({ to: "alice", amount: parseDJT("1.5") }) // a name or an address
console.log(prepared.description) // "Send 1.5 DJT to V-local1… (alice) on the V-Chain"
const txID = await wallet.submit(prepared) // signs here, then issues
await wallet.waitForAcceptance("V", txID)
```

Everything that moves funds follows the same steps. `prepare…()` returns the transaction, a description, the fee, and (for names) the registry evidence. Nothing is signed until `submit()`.

## Wallets

| Wallet | Create | Signs | Notes |
|---|---|---|---|
| `MnemonicWallet` | `create(client)`, `fromMnemonic(client, words, account?)` | yes | HD: `m/44'/9000'/account'/{0,1}/i` on V and M, `m/44'/60'/0'/0/account` on U. These are the web wallet's paths, so its mnemonics open with the same addresses |
| `SingletonWallet` | `fromPrivateKey(client, "PrivateKey-…" or "0x…")` | yes | One key on every chain; its 32 bytes are also the EVM key, as in the web wallet |
| `ReadOnlyWallet` | `fromXpub(client, xpub, evmXpub)` | **no** | Addresses, balances and history from extended public keys (`getXpub()`, `getEvmXpub()`) |
| `LedgerWallet` | `await connect(client, { transport, acknowledgeExperimental: true })` | yes, **experimental** | See [Ledger](#ledger-experimental) |

`wallet.capabilities` reports what each wallet can do: `sign`, `hd`, `hardware`, `experimental`, per-chain support, `messageSigning`, `exportSecret`. Operations a wallet can't perform throw `DijetsUnsupportedError`; they never fail silently.

## What a wallet does

| Area | Methods |
|---|---|
| Addresses | `getAddress("V" \| "M")`, `getChangeAddress()`, `getAddresses(chain)`, `getEvmAddress()`, `getUAtomicAddress()`, `scan()` |
| Balances | `getBalance()` → V per asset (unlocked and locked), M (unlocked, lockedStakeable, lockedNotStakeable, staked), U (wei); `getDJTBalance(chain)`; `getUtxos(chain)` |
| Recipients | `resolveRecipient(input, chain)`: an address (checked for chain and network) or a name (resolved through the registry, ACTIVE only) |
| V-Chain | `prepareSend({ to, amount, assetID?, memo? })`, `send(…)` |
| U-Chain EVM | `sendEvm({ to, value?, data?, gasLimit? })`, `sendErc20(token, to, amount)`, `sendErc721(token, to, id)`, `evmProvider()` |
| Cross-chain | `prepareExport(from, to, amount)`, `prepareImport(into, from)`, `moveDJT(from, to, amount)` for every pair of V, M and U |
| Staking | `prepareValidate(…)`, `prepareDelegate(…)` (Apricot transactions, accepted on every network) |
| NFTs (V) | `prepareCreateNftFamily({ name, symbol, groups })`, `prepareMintNft({ familyAssetID, payload, to? })` |
| Names | `prepareRegisterName({ name, expiry })`, `prepareRenewName(name, expiry)`, `getName()` |
| Arcs | `arc(chainID, feeAssetID)` → `getAddress()`, `getBalance()`, `send({ to, amount })` on the Arc's own chain |
| History | `getHistory()`, from the explorer (an optional service; set `explorerUrl` on the client) |
| Messages | `signMessage(text, index?)`, `verifyMessage(text, sig, hrp)`, `signEvmMessage(text)` |
| Key files | `exportKeyFile(password)`, `openKeyFile(client, file, password)`, `exportKeyFile(wallets, password)` |

Amounts are `bigint`: nDJT (9 decimals) on V and M, wei (18 decimals) on U. Use `parseDJT` and `formatDJT` from the platform library.

### Names

`prepareSend({ to: "alice", … })` resolves the name through the registry before building anything:

- It accepts only an ACTIVE record with at least ten minutes before expiry.
- It checks the target is on the client's network.
- It puts the registry evidence (record ID, version, M-Chain block) in `prepared.recipient.name`, so the user can review it before signing.

Names point at V- and M-Chain key hashes. They cannot name a U-Chain EVM account, so `resolveRecipient(name, "U")` refuses. The registry is active on mainnet, local and custom networks, not on Lothar; `client.names.isActive()` tells you.

### Arcs

An Arc's chain uses the same keys, addressed with the Arc's chain ID. Fees are paid in the Arc's own fee asset, the first asset in its genesis. You get its ID from the Arc's spec, or with `client.arcChain(id).getAssetDescription(<alias>)`. Atomic transfers between an Arc and V, M or U are rejected by the protocol, so the Arc wallet offers none.

### Payments service (optional)

`PaymentsClient` talks to the transaction service (`txservice`, `payments.*`). This is a separate deployment that pays names under a delegation policy. Wallets don't depend on it.

## Key files

Key files use the Dijets web wallet's format:

- **Reads** versions 2.0 to 6.0.
- **Writes** 6.0: PBKDF2-SHA256 (200,000 iterations) over `sha256(password ‖ salt)`, then AES-256-GCM.
- **Entry types** are `"mnemonic"` and `"singleton"`.
- **Files from 2.0 to 4.0** hold raw keys. They open as the 24-word mnemonic of the key, exactly as the web wallet opens them.
- **A wrong password** throws `KeystoreError` with `reason: "INVALID_PASSWORD"`.

The format records no KDF parameters, so the iteration count can't be raised without breaking compatibility. Use a long password. Reads are independent of each other: upstream's shared iteration counter, which could mix versions under concurrency, is gone.

## Security

- **Secrets stay in the process.** Mnemonics and keys are held in `Secret` objects, masked in memory, and shown as `[secret]` in JSON, `util.inspect`, `String()` and logs. `wipe()` overwrites them; the wallet can't sign afterwards.
- **No secret is ever sent anywhere.** Signing is local, and the keystore API of the node is not used.
- **Reading and signing are separate.** A `ReadOnlyWallet` holds no keys, and every signing path checks `capabilities.sign`.
- **Recipients are checked** for chain and network. A wrong-network or wrong-chain address, or an EVM address given for V or M, is refused before anything is built.
- **In browsers,** keys in page memory are exposed to any script on the page. Prefer signing in an isolated context, such as an extension or a worker, and never put a mnemonic in `localStorage`. In Node, keep key files at mode 0600.
- **Message signing** keeps the inherited prefix `"\x1AAvalanche Signed Message:\n"` for compatibility with the web wallet and existing verifiers.

## Ledger (experimental)

There is no Dijets Ledger app. `LedgerWallet` drives the Avalanche Ledger app, with the Ethereum app for U-Chain EVM transactions. It has **not been tested against a device**.

- **Blind signing:** V, M and U atomic transactions are signed by hash (`signHash`). The device shows only the transaction hash, and hash signing must be enabled in the app.
- **No device address display:** the app can't parse Dijets transactions, and its address display allows at most 4 HRP characters; `dijets` and `lothar` have 6.
- **Addresses** come from the device's extended public key and match `MnemonicWallet`'s for the same seed. A mock-device test checks that the signed bytes are identical.
- **Supported:** V transfers, imports and exports; M imports, exports, validation and delegation; U atomic imports and exports; EVM transactions.
- **Refused:** name, subnet and Arc transactions.
- **Opt in:** you must pass `acknowledgeExperimental: true`. Install the optional peers `@ledgerhq/hw-transport-*`, `@obsidiansystems/hw-app-avalanche` and `@ledgerhq/hw-app-eth`.

## Compatibility with avalanche-wallet-sdk 0.18.3

The capabilities are kept; the API is Dijets-native. It doesn't use X/P/C names, a global `setNetwork`, or Avalanche services.

| Upstream | Here |
|---|---|
| `MnemonicWallet`, `SingletonWallet`, `PublicMnemonicWallet`, `LedgerWallet` | Same wallets; `PublicMnemonicWallet` is `ReadOnlyWallet` |
| `getAddressX/P/C`, `getEvmAddressBech` | `getAddress("V" \| "M")`, `getEvmAddress()`, `getUAtomicAddress()` |
| `sendAvaxX`, `sendANT`, `sendAvaxC`, `sendErc20`, `sendERC721` | `prepareSend` / `send`, `sendEvm`, `sendErc20`, `sendErc721` |
| `exportXChain/PChain/CChain`, `importX/P/C` | `prepareExport`, `prepareImport`, `moveDJT` for all six directions |
| `validate`, `delegate` | `prepareValidate`, `prepareDelegate` |
| `createNftFamily`, `mintNft` | `prepareCreateNftFamily`, `prepareMintNft` |
| Keystore `readKeyFile`, `makeKeyfile` | `readKeyFile`, `makeKeyFile`, `openKeyFile`, `exportKeyFile` (same format) |
| `signMessage` | `signMessage` (byte-compatible), `verifyMessage` |
| `setNetwork`, network presets | One `DijetsClient` per wallet (`@dijets/platform-js` networks) |
| History via Ortelius, Glacier, Snowtrace | `getHistory()` via the Dijets explorer |
| CoinGecko prices | Not included. The previous patch priced DJT as AVAX |
| Universal transactions (automatic cross-chain gathering) | Not ported; use `moveDJT` explicitly |

## Tests

| Command | What |
|---|---|
| `npm test` | 35 unit tests, offline (see below) |
| `npm run test:integration` | Live, against a devnet (see below) |

The unit tests cover:

- key files 2.0 to 6.0, from upstream's fixtures;
- upstream's 43 derived addresses, re-encoded for Dijets by the node;
- xpub wallets at both EVM levels;
- message signatures checked against the **unmodified upstream library**;
- the Ledger adapter on a mock device;
- secret redaction, recipient checks and wallet-patch regressions.

The integration tests run against a live devnet:

- with `DIJETS_NODE_URL`: funding and scanning, V → M, V → U → V with an EVM transfer, registering a name and paying it by name from another wallet, renewal, delegation, NFT creation and minting, key-file reopening, and a read-only wallet;
- with `DIJETS_ARC_NODE_URL`: a transfer on an Arc.

See `../dijets-platform-js/README.md` for starting a devnet with the node's own harness.

## Examples

`examples/` (run with `npx tsx examples/<file>.ts`; configure with `DIJETS_NETWORK` and `DIJETS_NODE_URL`; the mnemonic is read from `MNEMONIC` and never printed):

| # | Example | Kind |
|---|---|---|
| 01 | create a wallet and save an encrypted key file | offline |
| 02 | open a key file | offline |
| 03 | scan an HD wallet and show its balances | read-only |
| 04 | send to an address or a name, after review | broadcast only with `BROADCAST=1` |
| 05 | move DJT between chains | broadcast only with `BROADCAST=1` |
| 06 | watch a wallet from xpubs | read-only |
| 07 | sign and verify a message | offline |
| 08 | open a Ledger | experimental, untested on a device |

## Licence

BSD-3-Clause, © 2026 Dijets Inc. Limited. Derived from avalanche-wallet-sdk (BSD-3-Clause, © 2021 Ava Labs): see `LICENSE.upstream`.
