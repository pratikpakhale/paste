// Test environment: a DOM and an in-memory IndexedDB, registered before anything imports Dexie.
import "fake-indexeddb/auto"
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register({ url: "http://localhost/" })
