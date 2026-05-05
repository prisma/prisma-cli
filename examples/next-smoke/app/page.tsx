export default function Home() {
  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Prisma CLI</p>
        <h1>Next.js smoke app</h1>
        <p className="lede">
          This app exists to manually test the local source Prisma CLI from inside this repository.
        </p>
        <ol className="steps">
          <li>
            Run <code>pnpm prisma auth login</code>
          </li>
          <li>
            Run <code>pnpm prisma app deploy --app next-smoke</code>
          </li>
        </ol>
      </section>
    </main>
  );
}
