import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { buildOpenApiDocument } from './swagger.config.js';

async function bootstrap() {
  // bufferLogs: bootstrap-time log lines are held until app.useLogger below
  // swaps in the real (pino) logger, instead of going out through Nest's
  // default console logger and never appearing in structured form.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));

  app.use(helmet());

  const config = app.get(ConfigService);

  app.enableCors({ origin: config.getOrThrow<string[]>('app.corsOrigins') });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  if (config.getOrThrow<boolean>('swagger.enabled')) {
    SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
  }

  app.enableShutdownHooks();

  await app.listen(config.getOrThrow<number>('app.port'));
}

await bootstrap();
