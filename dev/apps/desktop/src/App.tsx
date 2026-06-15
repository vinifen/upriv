import { AppProviders } from "@/app";
import { VaultListPage } from "@/features/vaults/list";

export default function App() {
  return (
    <AppProviders>
      <VaultListPage />
    </AppProviders>
  );
}
