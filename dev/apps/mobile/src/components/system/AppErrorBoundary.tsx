import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

interface AppErrorBoundaryProps {
  children: ReactNode;
  onReload: () => void;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

/**
 * Root fallback — independent of i18n and app providers.
 * English literals are intentional (the crash may have come from I18nProvider).
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[upriv] ui crash", error, info.componentStack);
    void import("@/lib/rpc")
      .then(({ rpcLogEvent }) => rpcLogEvent("ui_crash"))
      .catch(() => undefined);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.panel} accessibilityRole="alert">
        <Text style={styles.title}>Upriv encountered an error</Text>
        <Text style={styles.body}>
          Reload the screen. If this keeps happening, force-quit and reopen the app.
        </Text>
        <Text style={styles.message}>{this.state.error.message}</Text>
        <Pressable
          onPress={this.props.onReload}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel="Reload"
        >
          <Text style={styles.buttonLabel}>Reload</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    padding: 24,
    backgroundColor: "#121212",
    justifyContent: "center",
  },
  title: {
    color: "#ececec",
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
  },
  body: {
    color: "#c8c8c8",
    fontSize: 15,
    marginBottom: 16,
  },
  message: {
    color: "#a0a0a0",
    fontFamily: "monospace",
    fontSize: 13,
    marginBottom: 24,
  },
  button: {
    alignSelf: "flex-start",
    backgroundColor: "#3d7a5a",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonLabel: {
    color: "#fff",
    fontWeight: "600",
  },
});
