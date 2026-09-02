import { writeFile } from 'node:fs/promises';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { buildOpenApiDocument } from '../src/swagger.config.js';

// Boots the real app (so the document reflects real routes/DTOs, not a
// hand-maintained copy) far enough to introspect metadata, without binding a
// port. Needs `docker compose up -d` running first — DatabaseModule and
// QueuesModule construct real Postgres/Redis connections during module init.
async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  await app.init();

  const document = buildOpenApiDocument(app);
  await writeFile('openapi.json', JSON.stringify(document, null, 2) + '\n', 'utf8');

  await app.close();
  console.log('Wrote openapi.json');
}

await generate();
