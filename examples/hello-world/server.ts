const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
      });
    }

    return new Response("Hello from the Prisma CLI preview!\n", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  },
});

console.log(`Listening on http://localhost:${server.port}`);
