import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { buildContainer } from "./modules/container.js";

async function bootstrap() {
  const container = await buildContainer();
  const app = buildApp(container);
  app.listen(env.PORT, () => {
    process.stdout.write(`Server listening on http://localhost:${env.PORT}\n`);
  });
}

bootstrap().catch((error) => {
  process.stderr.write(`Failed to start server: ${String(error)}\n`);
  process.exit(1);
});
