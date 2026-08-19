import "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProviders } from "@/providers/AppProviders";
import { VaultListScreen } from "@/features/vaults/list/VaultListScreen";
import { useTheme } from "@/theme";

export type RootStackParamList = {
  VaultList: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function ThemedNavigation() {
  const { colors, theme, statusBarStyle } = useTheme();
  const base = theme === "light" ? DefaultTheme : DarkTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: colors.background,
      card: colors.surfaceContainer,
      text: colors.onSurface,
      border: colors.outlineVariant,
      primary: colors.accent,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style={statusBarStyle} />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="VaultList" component={VaultListScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProviders>
        <ThemedNavigation />
      </AppProviders>
    </SafeAreaProvider>
  );
}
