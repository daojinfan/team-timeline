import { AsyncLocalStorage } from "node:async_hooks";

// Keeps the authenticated request identity available to legacy business helpers
// that predate the explicit request-context parameter.
export const requestContextStorage = new AsyncLocalStorage();
