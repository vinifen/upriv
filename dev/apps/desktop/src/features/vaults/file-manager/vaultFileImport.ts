import { vaultFileLanguageFromPath } from "@upriv/shared";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export async function readImportFileContent(file: File): Promise<string> {
  const language = vaultFileLanguageFromPath(file.name);
  if (language === "binary") return "";
  if (language === "image") return readAsDataUrl(file);
  return file.text();
}
