import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

// Shared by main.ts (serves it at /docs) and scripts/generate-openapi.ts
// (writes it to openapi.json) so the two can never drift apart.
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Nframa API')
    .setDescription('Backend API for Nframa, a fixed-route ride platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  return SwaggerModule.createDocument(app, config);
}
