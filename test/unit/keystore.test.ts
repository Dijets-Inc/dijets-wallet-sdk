// Key files: upstream avalanche-wallet-sdk 0.18.3's fixtures (test/Keystore,
// password 111111111), the format the Dijets web wallet reads and writes.
import * as bip39 from "bip39"
import { DijetsClient, utils } from "@dijets/platform-js"
import { readKeyFile, makeKeyFile, openKeyFile, exportKeyFile, KeystoreError, MnemonicWallet, SingletonWallet } from "../../src"

const KEYFILE_2 = `{"version":"2.0","salt":"2SjQXSMR87tBvYqbkwTFL61gEdwR","pass_hash":"2NJf6rqPshCU69hMkPEMBLBZLfBKshHy68cWgNY7kNmAM988Qt","keys":[{"key":"C8JG3QvhF9XUiXMyAmQoTfTkWg5UySMPKeCrkGH8u67HrqStNtBxZyDxLY6NrSS8k51Fg3V","iv":"Fc8Xyxmhd2X55sgjy4aTxN","address":"X-EAZkJNdFBjVQQ7zS81hWCnRHfMKf3vpYH"},{"key":"p52F7MGpyicfG2c7RXuKKKpUE7X9qjLX7qx2ju3mei58jU4vCxRQpjcR6RvSKbozphMT1s8","iv":"N6fYr5gT4TJfB6Tzs9oLMN","address":"X-7r1aDs2jiJHr1reFfLFzzKrprZruXVzqM"}]}`
const KEYFILE_3 = `{"version":"3.0","salt":"kwkVtmPkafnwWbp65nYs2z9cQeN","pass_hash":"2gid7yJzvyg2Mz4HUJLh3jvgumpDJmRu2PBopqHYacVjwisp1g","keys":[{"key":"PiLrcsSBZ1fBE9v3axsHycfhta6NwMf56qqGKgxswr4VSNGL3kZUQG8YCCRG2q7QDN8y5mp","iv":"L7MojgHmudo2WpbMCdfgCg","address":"X-7r1aDs2jiJHr1reFfLFzzKrprZruXVzqM"},{"key":"uDvvzSQQxkFGhYUvDcRFmWtKbqJEZ8swKgMx7Ba3eWUoTMaikvV2oD2jUFzaS35WdP8rtqF","iv":"AN8nLnaK84rfoKXtxm6evy","address":"X-EAZkJNdFBjVQQ7zS81hWCnRHfMKf3vpYH"},{"key":"g1AcoW7iXtiui87GVy466NkkHsGfQRRptfVLyboBUDtMart1NktRLfzZDxhVifBvU2Vxtzi","iv":"U3VZnEr8HgiD3rcNW6Abko","address":"X-7r1aDs2jiJHr1reFfLFzzKrprZruXVzqM"}],"warnings":["This address listed in this file is for internal wallet use only. DO NOT USE THIS ADDRESS"]}`
const KEYFILE_4 = `{"version":"4.0","salt":"UWLRsfsyjY51E1s8CVa7cvvMHMz","pass_hash":"M6mzyfS4i4bKBxXQZFuQ6BsRnMSVMe7GnBd1HTmVLi2jcscPA","keys":[{"key":"s2RScHaFr6nr3JQkb8wNBbAPAWiGNkZRRmbUYY2tnxhCpdTgnHLyTDHXN4mdfEV4fVwFcMP","iv":"A6jQMX7e6doGS6wVvdLzA"}]}`
const KEYFILE_5 = `{"version":"5.0","salt":"TEUQMGR1XdHs5wb4SVSA7LriUhR","pass_hash":"avkdK9YFLn1zfZjvBsB9ipKRzfqr4rvqBryVosB6NUgFiv9kd","keys":[{"key":"5jVaPDgXd9nm3DF6XWSbvpGFKVd5yujnYekQCoK4evkoMBAWNz7Nc7YVKYUc6RQJiPy47rh1kfc2uydapEuVieN51eeHRATGqQP4Rj5wjN1xwKVgEsxvGeAytMevbYE9L2y4nCPyHvVcPQB66d7B5kdgYv3N7QVd3K284skjfGsZbZAT16vinjkZry8ypdwt2UV7c6WbVFX72BuEAajapn5TdkWCpPHJZgTkVs9utfndxYMW9m","iv":"Ak8DSMKMy4f1RXHSSt15KK"}]}`
const KEYFILE_6 = `{"version":"6.0","salt":"2NgqFaoYSe5foo8oEtcdB658c7Eb","activeIndex":0,"keys":[{"key":"KJYzUxFzn2EFazvAkfEgkbdJ7L2qeUTG5jTHUa9MunaNZWzNREd1GvYbwbUDdUsEu9Z5vB4kKW6x3farGCjtDHJ6c4nRCEnJKTUmFsBZ6CZqQ4MfXCMBXPvzvvDuv3VhYeE1LkiQHQRhEfKQGVaY282xDRifx3xyeT8ar18LxF3UPDNjX1D1EDLX4bTvbT4cChc8EPj9ufwXrov1y7Fcw3krJ5H87GnkwCZezzTxUeas1eTztZ","iv":"TQei93ehgGWgUKXkLha8Ef","type":"mnemonic"}]}`
const KEY_V2_V3 = "2DvMW4ZsNVdiiBsrEdPBTDr47bTtgr4H8qQKXz2D37YKeTLwDw"
const KEY_V4 = "jegD9bfh1qYjnyxUgnG92CEyAx7s4iZRgcYatdN2u1qhy1Tbr"
const KEY_V5_V6 = "solar ordinary sentence pelican trim ring indicate cake ordinary water size improve impose gentle frown sound know siren sick elder wait govern tortoise unit"
const PASS = "111111111"

// 2.0–4.0 files hold raw keys; the web wallet opens them as the mnemonic of the key's entropy.
const asMnemonic = (cb58: string) => bip39.entropyToMnemonic(utils.BinTools.getInstance().cb58Decode(cb58).toString("hex").padStart(64, "0"))

const client = new DijetsClient({ network: "local", url: "http://127.0.0.1:1" })

describe("reading key files (upstream fixtures)", () => {
  test.each([
    ["2.0", KEYFILE_2, asMnemonic(KEY_V2_V3)],
    ["3.0", KEYFILE_3, asMnemonic(KEY_V2_V3)],
    ["4.0", KEYFILE_4, asMnemonic(KEY_V4)],
    ["5.0", KEYFILE_5, KEY_V5_V6],
    ["6.0", KEYFILE_6, KEY_V5_V6]
  ])("version %s", async (_v, file, expected) => {
    const r = await readKeyFile(JSON.parse(file), PASS)
    expect(r.entries.map((e) => e.secret)).toContain(expected)
  })

  test.each([["2.0", KEYFILE_2], ["3.0", KEYFILE_3], ["4.0", KEYFILE_4], ["5.0", KEYFILE_5], ["6.0", KEYFILE_6]])("version %s rejects a wrong password", async (_v, file) => {
    await expect(readKeyFile(JSON.parse(file), "wrong")).rejects.toMatchObject({ reason: "INVALID_PASSWORD" })
  })

  test("files of different versions can be read concurrently (upstream shared the iteration count)", async () => {
    const [a, b, c] = await Promise.all([readKeyFile(JSON.parse(KEYFILE_2), PASS), readKeyFile(JSON.parse(KEYFILE_3), PASS), readKeyFile(JSON.parse(KEYFILE_6), PASS)])
    expect(a.entries[0].secret).toBe(asMnemonic(KEY_V2_V3))
    expect(b.entries.map((e) => e.secret)).toContain(asMnemonic(KEY_V2_V3))
    expect(c.entries[0].secret).toBe(KEY_V5_V6)
  })

  test("unsupported versions and non-files are refused", async () => {
    await expect(readKeyFile({ version: "7.0", salt: "x", keys: [] }, PASS)).rejects.toMatchObject({ reason: "INVALID_VERSION" })
    await expect(readKeyFile({ hello: 1 }, PASS)).rejects.toBeInstanceOf(KeystoreError)
  })
})

describe("writing key files", () => {
  test("6.0 round trip for mnemonic and single-key wallets", async () => {
    const m = MnemonicWallet.fromMnemonic(client, KEY_V5_V6)
    const s = SingletonWallet.fromPrivateKey(client, "PrivateKey-ewoqjP7PxY4yr3iLTpLisriqt94hdyDFNgchSxGGztUrTXtNN")
    const file = await exportKeyFile([m, s], "correct horse battery staple", 1)
    expect(file).toMatchObject({ version: "6.0", activeIndex: 1 })
    expect(file.keys.map((k) => k.type)).toEqual(["mnemonic", "singleton"])
    expect(JSON.stringify(file)).not.toContain("solar")
    expect(JSON.stringify(file)).not.toContain("ewoq")
    const opened = await openKeyFile(client, JSON.parse(JSON.stringify(file)), "correct horse battery staple")
    expect(opened.activeIndex).toBe(1)
    expect(opened.wallets[0].getAddress("V")).toBe(m.getAddress("V"))
    expect(opened.wallets[1].getAddress("V")).toBe(s.getAddress("V"))
    await expect(openKeyFile(client, file, "nope")).rejects.toMatchObject({ reason: "INVALID_PASSWORD" })
  })

  test("a password is required", async () => {
    await expect(makeKeyFile([{ type: "mnemonic", secret: KEY_V5_V6 }], "")).rejects.toBeInstanceOf(KeystoreError)
  })

  test("each file gets a fresh salt and IVs", async () => {
    const a = await makeKeyFile([{ type: "mnemonic", secret: KEY_V5_V6 }], PASS)
    const b = await makeKeyFile([{ type: "mnemonic", secret: KEY_V5_V6 }], PASS)
    expect(a.salt).not.toBe(b.salt)
    expect(a.keys[0].key).not.toBe(b.keys[0].key)
  })
})
