import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StyleSheet, View } from "react-native";

interface OverlayOrigin {
  x: number;
  y: number;
}

interface DropdownOverlayApi {
  /** Replace the single full-screen overlay layer (menus, not RN Modal). */
  setOverlay: (node: ReactNode | null) => void;
  /** Window origin of the overlay host — convert `measure()` pageX/pageY into overlay space. */
  measureHostOrigin: () => Promise<OverlayOrigin>;
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
  const rootRef = useRef<View>(null);
  const [overlay, setOverlayState] = useState<ReactNode>(null);
  const setOverlay = useCallback((node: ReactNode | null) => {
    setOverlayState(node);
  }, []);
  const measureHostOrigin = useCallback((): Promise<OverlayOrigin> => {
    return new Promise((resolve) => {
      const node = rootRef.current;
      if (!node) {
        resolve({ x: 0, y: 0 });
        return;
      }
      node.measure((_x, _y, _w, _h, pageX, pageY) => {
        resolve({
          x: Number.isFinite(pageX) ? pageX : 0,
          y: Number.isFinite(pageY) ? pageY : 0,
        });
      });
    });
  }, []);
  const api = useMemo(() => ({ setOverlay, measureHostOrigin }), [setOverlay, measureHostOrigin]);

  return (
    <DropdownOverlayContext.Provider value={api}>
      <View ref={rootRef} collapsable={false} style={styles.root}>
        <View style={styles.content}>{children}</View>
        {overlay != null ? (
          <View style={styles.layer} pointerEvents="auto">
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
