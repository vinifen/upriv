import { useState } from "react";
import { useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { vaultRowChrome, type VaultRowChrome } from "@upriv/shared";

const LIST_GUTTER_ESTIMATE = 32;

/**
 * Compact vs comfortable chrome from the row's own width (nested group rows
 * compact earlier). Window size is only the first-paint guess.
 */
export function useVaultRowChrome(): {
  chrome: VaultRowChrome;
  onLayout: (event: LayoutChangeEvent) => void;
} {
  const windowWidth = useWindowDimensions().width;
  const [width, setWidth] = useState(() => Math.max(windowWidth - LIST_GUTTER_ESTIMATE, 0));

  return {
    chrome: vaultRowChrome(width),
    onLayout: (event) => {
      const next = event.nativeEvent.layout.width;
      if (next > 0) setWidth(next);
    },
  };
}
