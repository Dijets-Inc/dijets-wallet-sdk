/**
 * Holds a secret (mnemonic or private key) so that it is not kept as a plain
 * string in the wallet object, never appears in logs, JSON or inspection,
 * and can be wiped. The value is masked with a random pad held alongside
 * it: protection against accidental exposure, not against a debugger with
 * access to process memory.
 */
const inspect = Symbol.for("nodejs.util.inspect.custom")

const random = (n: number): Uint8Array => {
  const b = new Uint8Array(n)
  globalThis.crypto.getRandomValues(b)
  return b
}

export class Secret {
  private masked: Uint8Array
  private pad: Uint8Array
  private wiped = false

  constructor(value: string) {
    const plain = new TextEncoder().encode(value)
    this.pad = random(plain.length)
    this.masked = plain.map((b, i) => b ^ this.pad[i])
    plain.fill(0)
  }

  /** The secret. Use it immediately; do not store or log it. */
  reveal(): string {
    if (this.wiped) throw new Error("This secret has been wiped")
    const plain = this.masked.map((b, i) => b ^ this.pad[i])
    const s = new TextDecoder().decode(plain)
    plain.fill(0)
    return s
  }

  /** Overwrites the secret. Later `reveal()` calls throw. */
  wipe(): void {
    this.masked.fill(0)
    this.pad.fill(0)
    this.wiped = true
  }

  toString(): string {
    return "[secret]"
  }
  toJSON(): string {
    return "[secret]"
  }
  [inspect](): string {
    return "[secret]"
  }
}
