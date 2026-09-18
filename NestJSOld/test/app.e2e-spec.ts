import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

// Requires Postgres + Redis reachable (docker compose up -d) — AppModule
// wires DatabaseModule/QueuesModule, same as the real app.
describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors main.ts: versioning isn't part of AppModule itself, so a test
    // app needs to enable it the same way main.ts does for /v1 routes to exist.
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live returns 200 without checking any dependency', async () => {
    const response = await request(app.getHttpServer()).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready confirms Postgres and Redis are reachable', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('wraps an unknown /v1 route in the standard error envelope with a request id', async () => {
    const response = await request(app.getHttpServer()).get('/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });
});
