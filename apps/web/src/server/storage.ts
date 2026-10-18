import type { LocalStorage, Storage } from "@shortloop/providers";

/**
 * Duck-typed check: `instanceof` is unreliable when the bundler gives route chunks their own copy of
 * the providers module, so we look for LocalStorage's signing methods instead.
 */
export function isLocalStorage(s: Storage): s is LocalStorage {
  const l = s as Partial<LocalStorage>;
  return (
    typeof l.verify === "function" && typeof l.verifyPut === "function" && typeof l.putStream === "function"
  );
}
