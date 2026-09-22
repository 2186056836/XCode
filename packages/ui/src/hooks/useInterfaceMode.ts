import { useXCodeStoreWithDefault } from "@/store/StoreProvider.js";

export function useIsOfficeMode(): boolean {
  return useXCodeStoreWithDefault((state) => state.interfaceMode === "office", false);
}
