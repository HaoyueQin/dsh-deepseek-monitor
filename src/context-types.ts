/**
 * Structural types for the cordis services this plugin consumes. A
 * third-party plugin resolves outside the DSH monorepo's single cordis
 * instance, so the upstream `declare module 'cordis'` augmentations do not
 * reach this Context — the members below mirror the actual runtime shapes
 * this plugin touches. Drift from upstream is contained to this file.
 *
 * This file must stay FREE of Node.js types (`node:http`, `node:stream`,
 * `Buffer`): it is part of the CLIENT-reachable declaration graph, so a Node
 * import here would leak into browser-only consumer builds.
 */
import type { Context } from 'cordis'

/** The request face route handlers see (structural subset of node's
 *  IncomingMessage). */
export interface DsmHttpRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>
}

/** The response face route handlers write to (structural subset of node's
 *  ServerResponse). */
export interface DsmHttpResponse {
  statusCode: number
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

/** One named webserver route (mirror of the host-webserver WebRoute). */
export interface DsmWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: DsmHttpRequest, res: DsmHttpResponse) => void | Promise<void>
}

/** The webserver service (mirror of @deepseek-ai/dsh-host-webserver). */
export interface DsmWebServer {
  register(route: DsmWebRoute): () => void
}

/** One resolved credential value and its source layer (mirror of the
 *  credentials seam's ResolvedCredential). */
export interface DsmResolvedCredential {
  value: string
  source: string
}

/** Value-free configuration facts for one reference (mirror of CredentialInfo). */
export interface DsmCredentialInfo {
  configured: boolean
  source?: string
  writable: boolean
}

/** The credential seam (structural mirror of @deepseek-ai/dsh-credentials
 *  members this plugin touches). References travel as plain strings across
 *  this structural face; the brand exists upstream only. */
export interface DsmCredentials {
  resolve(ref: string): Promise<DsmResolvedCredential | undefined>
  describe(ref: string): Promise<DsmCredentialInfo>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

/** The raw session event shape the plugin reads (structural subset). */
export interface DsmSessionEvent {
  type: string
  seq: number
  time: number
  data: unknown
}

/** A provider/model route shape (both halves). */
export interface ModelRoute {
  provider?: string
  model?: string
}

/** A live session handle's route face (mirror of dsh-session SessionStore
 *  members this plugin touches; `requestContext` folds the log's
 *  `request/context` events and is authoritative even before any change). */
export interface DsmSessionHandle {
  requestContext?(): ModelRoute | undefined
}

/** The live session store (mirror of @deepseek-ai/dsh-session SessionStore). */
export interface DsmSessionStore {
  list(): unknown[]
  get(id: string): DsmSessionHandle | undefined
}

/** One storage-domain table (mirror of dsh-storage-domain KvTable members
 *  this plugin touches). `keys()` is a snapshot iterator on both kernels. */
export interface DsmKv {
  get(key: string): unknown | undefined
  keys(): IterableIterator<string>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
}

/** One opened storage domain. */
export interface DsmDomain {
  table(name: string): DsmKv
}

/** The storage-domain hub (mirror of @deepseek-ai/dsh-storage-domain). */
export interface DsmStorageDomain {
  open(spec: { name: string, version: number, tables: Record<string, unknown> }): Promise<DsmDomain>
}

declare module 'cordis' {
  interface Context {
    effect(dispose: () => void | (() => void), label?: string): void
    webServer: DsmWebServer
    sessions: DsmSessionStore
    credentials: DsmCredentials
    storageDomain: DsmStorageDomain
    on(event: 'session/event', listener: (sessionId: unknown, event: DsmSessionEvent) => void): () => void
    on(event: string, listener: (...args: never[]) => void): () => void
  }
}

/** The augmented cordis Context (host + client halves). */
export type { Context }
