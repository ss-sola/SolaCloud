import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SystemServiceConfig } from '@/validate.config';

describe('SystemServiceConfig', () => {
  it('should parse SessionSecure=false as boolean false', () => {
    const config = plainToInstance(
      SystemServiceConfig,
      {
        ServiceName: 'system-service',
        Port: '3200',
        RegistryUrl: 'http://localhost:3001',
        DbDriver: 'postgres',
        DbHost: 'localhost',
        DbPort: '5432',
        DbUsername: 'postgres',
        DbPassword: 'fixture-db-password',
        DbDatabase: 'nest_cloud',
        SessionSecret: 'fixture-session-signing-key',
        SessionSecure: 'false',
      },
      { enableImplicitConversion: true },
    );

    expect(validateSync(config).length).toBe(0);
    expect(config.SessionSecure).toBe(false);
  });
});
