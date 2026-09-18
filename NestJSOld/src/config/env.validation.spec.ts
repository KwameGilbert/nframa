import { validateEnv } from './env.validation.js';

const validEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/nframa',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateEnv', () => {
  it('accepts a minimal valid environment and fills in defaults', () => {
    const env = validateEnv(validEnv);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.SWAGGER_ENABLED).toBe(true);
  });

  it('coerces numeric env vars from strings', () => {
    const env = validateEnv({ ...validEnv, PORT: '4000', THROTTLE_LIMIT: '50' });

    expect(env.PORT).toBe(4000);
    expect(env.THROTTLE_LIMIT).toBe(50);
  });

  it('throws a readable error when a required var is missing', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects an unrecognized NODE_ENV value', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow();
  });
});
