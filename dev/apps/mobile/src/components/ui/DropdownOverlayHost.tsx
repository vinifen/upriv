import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

interface DropdownOverlayApi {
  /** Replace the single full-screen overlay layer (menus, not RN Modal). */
  setOverlay: (node: ReactNode | null) => void;
}

const DropdownOverlayContext = createContext<DropdownOverlayApi | null>(null);

export function useDropdownOverlay(): DropdownOverlayApi {
  const ctx = useContext(DropdownOverlayContext);
  if (!ctx) {
    throw new Error("useDropdownOverlay requires DropdownOverlayProvider");
  }
  return ctx;
}

/**
 * Same window as the app tree — avoids Android RN Modal / measureInWindow
 * coordinate skew that misplaces anchored menus.
 */
export function DropdownOverlayProvider({ children }: { children: ReactNode }) {
  const [overlay, setOverlayState] = useState<ReactNode>(null);
  const setOverlay = useCallback((node: ReactNode | null) => {
    setOverlayState(node);
  }, []);
  const api = useMemo(() => ({ setOverlay }), [setOverlay]);

  return (
    <DropdownOverlayContext.Provider value={api}>
      <View style={styles.root}>
        <View style={styles.content}>{children}</View>
        {overlay != null ? (
          <View style={styles.layer} pointerEvents="box-none">
            {overlay}
          </View>
        ) : null}
      </View>
    </DropdownOverlayContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    elevation: 10000,
  },
});
