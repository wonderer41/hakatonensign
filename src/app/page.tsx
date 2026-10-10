export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <section className="w-full max-w-3xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl shadow-cyan-950/20 sm:p-16">
        <p className="mb-6 text-sm font-medium uppercase tracking-[0.3em] text-cyan-300">
          Continuum
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-6xl">
          Your work, connected.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-slate-300">
          Continuum is a customizable productivity dashboard designed to bring
          your work activity together and help you recover context when you
          need it.
        </p>
        <p className="mt-10 inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-100">
          Under development
        </p>
      </section>
    </main>
  );
}
