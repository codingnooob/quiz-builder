// The empty landing (plan 06 §2): the first prompt builds the real app. No sign-in links: an app has them only once
// it has accounts (`accounts: true` in src/lib/site.ts puts them in the header).
export default function Home() {
  return (
    <main className="mx-auto max-w-md px-6 py-[15vh]">
      <h1 className="text-3xl font-semibold tracking-tight">Your app starts here</h1>
      <p className="mt-3 text-zinc-600">Describe what you want to build and Totalum will build it.</p>
    </main>
  );
}
