import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Dimensions, Easing, Image, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { BOOT_COVER_FADE_MS, BOOT_COVER_MIN_MS, DEFAULT_UI_THEME } from "@upriv/shared";
import { hideNativeSplash, isNativeSplashVisible, msSinceLaunch } from "@/lib/nativeSplash";
import { ThemeScope, colorsForTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import splashImage from "../../../../assets/splash-icon.png";

const BOOT_COLORS = colorsForTheme(DEFAULT_UI_THEME);
/** `imageWidth` of the `expo-splash-screen` plugin in `app.json` (same `splash-icon.png`). */
const SPLASH_IMAGE_SIZE = 150;
/** Tailwind `ease-in` (desktop `AppBootCover`); the native splash fade also accelerates. */
const BOOT_COVER_EASING = Easing.bezier(0.4, 0, 1, 1);

interface AppBootCoverProps {
  /** Settings and the first vault-root resolve settled — fade out and unmount. */
  done: boolean;
  /** Budgeted status / retry under the logo; `null` while the launch is still quick. */
  status: ReactNode;
}

/**
 * JS twin of the native splash (same color, logo, and position) pinned to the default theme.
 * The native splash stays up until the launch settles — then it fades straight into the app —
 * or until a budgeted status must show, in which case it hands off to this cover.
 */
export function AppBootCover({ done, status }: AppBootCoverProps) {
  const coverRef = useRef<View>(null);
  const opacity = useRef(new Animated.Value(1)).current;
  const [logoTop, setLogoTop] = useState<number | null>(null);
  const [gone, setGone] = useState(false);
  const hasStatus = status != null;

  useEffect(() => {
    if (!done) return;
    let fade: Animated.CompositeAnimation | null = null;
    const id = setTimeout(
      () => {
        if (isNativeSplashVisible()) {
          setGone(true);
          hideNativeSplash();
          return;
        }
        fade = Animated.timing(opacity, {
          toValue: 0,
          duration: BOOT_COVER_FADE_MS,
          easing: BOOT_COVER_EASING,
          useNativeDriver: true,
        });
        fade.start(({ finished }) => {
          if (finished) setGone(true);
        });
      },
      Math.max(0, BOOT_COVER_MIN_MS - msSinceLaunch()),
    );
    return () => {
      clearTimeout(id);
      fade?.stop();
    };
  }, [done, opacity]);

  useEffect(() => {
    if (!done && hasStatus && logoTop !== null) hideNativeSplash();
  }, [done, hasStatus, logoTop]);

  if (gone) return null;

  const measureLogo = () => {
    coverRef.current?.measureInWindow((_x, y) => {
      setLogoTop(Dimensions.get("screen").height / 2 - y - SPLASH_IMAGE_SIZE / 2);
    });
  };

  return (
    <ThemeScope theme={DEFAULT_UI_THEME}>
      <Animated.View
        ref={coverRef}
        onLayout={measureLogo}
        style={[styles.cover, { backgroundColor: BOOT_COLORS.background, opacity }]}
        pointerEvents={done ? "none" : "auto"}
        accessibilityViewIsModal={!done}
      >
        {done ? null : <StatusBar style="light" translucent />}
        {logoTop === null ? null : (
          <>
            <Image
              source={splashImage}
              style={[styles.logo, { top: logoTop }]}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
            <View style={[styles.status, { top: logoTop + SPLASH_IMAGE_SIZE }]}>{status}</View>
          </>
        )}
      </Animated.View>
    </ThemeScope>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 200,
    elevation: 200,
  },
  logo: {
    position: "absolute",
    alignSelf: "center",
    width: SPLASH_IMAGE_SIZE,
    height: SPLASH_IMAGE_SIZE,
  },
  status: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    alignItems: "center",
    gap: spacing.md,
  },
});
