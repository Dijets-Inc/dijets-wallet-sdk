/**
 * A client for the Dijets transaction service (`txservice`, `payments.*` at
 * /ext/payments): an optional, separate service that holds an agent key and
 * pays names under a delegation policy (per-payment and daily limits, user
 * approval). It is not part of the node; see dijetsnodesgo docs/naming/02-api.md.
 *
 * Every call needs the service's bearer token. An agent token can prepare
 * payments and submit policy-approved ones; an approver token can approve.
 * The `digest` from `prepare` must be shown to the user and passed back to
 * `approve`, so an approval always refers to the exact payment seen.
 */
import { Transport, DijetsRpcError } from "@dijets/platform-js"

export type PaymentStatus = "PREPARED" | "APPROVED" | "SUBMITTED" | "ACCEPTED" | "REJECTED" | "FAILED" | "CANCELLED" | "EXPIRED"

export interface Payment {
  id: string
  status: PaymentStatus
  to: { name: string; address: string; record: { recordID: string; generation: string; version: string; expiry: string; blockID: string; height: string } }
  amount: { units: string; display: string }
  fee?: { units: string; display: string }
  memo?: string
  digest?: string
  approvalRequired?: boolean
  approvedBy?: string
  txID?: string
  [k: string]: unknown
}

/** The service's machine-readable failure, from `error.data.reason`. */
export class PaymentsError extends Error {
  constructor(
    readonly reason: string,
    readonly detail: string | undefined,
    readonly rpcCode: number | undefined,
    message: string
  ) {
    super(message)
    this.name = "PaymentsError"
  }
}

export class PaymentsClient {
  private readonly transport: Transport

  constructor(options: { url: string; token: string; timeoutMs?: number; fetch?: typeof fetch }) {
    this.transport = new Transport({ baseUrl: options.url, authToken: options.token, timeoutMs: options.timeoutMs, fetch: options.fetch })
  }

  private async call<T = any>(method: string, params: object = {}): Promise<T> {
    try {
      return await this.transport.call<T>("/ext/payments", `payments.${method}`, params)
    } catch (e) {
      if (e instanceof DijetsRpcError) {
        const d: any = e.data ?? {}
        throw new PaymentsError(d.reason ?? "error", d.detail, e.rpcCode, e.message)
      }
      throw e
    }
  }

  info = () => this.call("info")
  /** Whether a name can be paid now, and why not if it cannot. */
  resolve = (name: string) => this.call("resolve", { name })
  /** Prepares (does not sign or send) a payment to a name. */
  prepare = (req: { delegation: string; recipient: string; asset: string; amount: string; idempotencyKey?: string; note?: string }) =>
    this.call<{ payment: Payment }>("prepare", req)
  get = (paymentID: string) => this.call<{ payment: Payment }>("get", { paymentID })
  /** Also polls the V-Chain for submitted payments. */
  status = (paymentID: string) => this.call<{ payment: Payment }>("status", { paymentID })
  /** Approver only. `digest` must be the one the user saw. */
  approve = (paymentID: string, digest: string) => this.call<{ payment: Payment }>("approve", { paymentID, digest })
  /** Re-resolves and re-checks policy, then builds, signs and issues. Idempotent. */
  submit = (paymentID: string) => this.call<{ payment: Payment }>("submit", { paymentID })
  cancel = (paymentID: string) => this.call<{ payment: Payment }>("cancel", { paymentID })
  /** For ACCEPTED payments: the payment and its transaction as read back from the chain. */
  receipt = (paymentID: string) => this.call("receipt", { paymentID })
  balance = (delegation: string) => this.call("balance", { delegation })
  history = (delegation: string, limit?: number) => this.call("history", { delegation, limit })
  describeTx = (txID: string) => this.call("describeTx", { txID })
  /** Approver only. Stops further payments and cancels pending ones. */
  revokeDelegation = (delegation: string) => this.call("revokeDelegation", { delegation })
}
