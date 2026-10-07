// Test environment: a DOM and an in-memory IndexedDB, registered before anything imports Dexie.
import "fake-indexeddb/auto"
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register({ url: "http://localhost/" })

// IndexedDB stores Blobs as Blobs. fake-indexeddb copies values with the runtime's structuredClone, which doesn't
// know happy-dom's Blob and hands back an empty object; keep them as they are (they're immutable) like a browser.
const nativeClone = globalThis.structuredClone
function cloneKeepingBlobs(value: unknown): unknown {
  if (value instanceof Blob) return value
  if (Array.isArray(value)) return value.map(cloneKeepingBlobs)
  if (value !== null && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneKeepingBlobs(v)]))
  return nativeClone(value)
}
globalThis.structuredClone = cloneKeepingBlobs
