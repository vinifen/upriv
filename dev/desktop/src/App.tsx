import en from "@i18n/en.json";

export default function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 text-slate-100">
      <h1 className="text-2xl font-semibold tracking-tight">
        {en["app.title"]}
      </h1>
      <p className="text-sm text-slate-400">Development scaffold — no features yet.</p>
    </main>
  );
}
