import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

import en from "../../shared/locales/en.json";

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{en["app.title"]}</Text>
      <Text style={styles.subtitle}>{en["mobile.scaffold.subtitle"]}</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#081425",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#d8e3fb",
    fontSize: 22,
    fontWeight: "600",
  },
  subtitle: {
    marginTop: 8,
    color: "#909097",
    fontSize: 14,
    textAlign: "center",
  },
});
