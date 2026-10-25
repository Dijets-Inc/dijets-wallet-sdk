// Checks the built package: both formats load with the same exports,
// declarations exist, @dijets/platform-js stays an external dependency
// (not bundled), and nothing machine-specific leaked into dist.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

const require = createRequire(import.meta.url)
const fail = (m) => {
  console.error(`check-dist: ${m}`)
  process.exit(1)
}
const cjs = require("../dist/index.cjs")
const esm = await import("../dist/index.mjs")
for (const name of ["MnemonicWallet", "SingletonWallet", "ReadOnlyWallet", "LedgerWallet", "openKeyFile", "PaymentsClient"]) {
  if (!cjs[name] || !esm[name]) fail(`missing export ${name}`)
}
if (Object.keys(cjs).sort().join() !== Object.keys(esm).sort().join()) fail("CommonJS and ESM exports differ")
statSync("dist/index.d.ts")
const code = readFileSync("dist/index.cjs", "utf8")
if (!/require\("@dijets\/platform-js"\)/.test(code)) fail("@dijets/platform-js is not imported as a dependency")
if (/class AVMAPI|PlatformVMAPI = class/.test(code)) fail("platform code was bundled into the wallet")
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))
for (const f of walk("dist")) {
  const text = readFileSync(f, "utf8").replace(/"sources(Content)?":\[[^\]]*\]/g, "")
  if (/\/Users\/|\/home\/[a-z]/.test(text)) fail(`${f} contains a machine-specific path`)
}
const { DijetsClient } = require("@dijets/platform-js")
const w = cjs.MnemonicWallet.create(new DijetsClient({ network: "local", url: "http://127.0.0.1:9650" }))
if (!w.getAddress("V").startsWith("V-local1")) fail("wallet did not derive a local address")
console.log(`check-dist: ok (${Object.keys(cjs).length} exports)`)
