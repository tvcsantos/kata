import type { KataBridge } from "../../shared/bridge";

declare global {
  interface Window {
    /** Exposed by the preload script via contextBridge. */
    kata: KataBridge;
  }
}

export {};
