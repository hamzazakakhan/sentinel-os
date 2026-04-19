import pino from 'pino';

const BASE_CONFIG: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label: string) => ({ level: label }),
    bindings: (bindings: pino.Bindings) => ({
      pid: bindings.pid,
      host: bindings.hostname,
      env: process.env.NODE_ENV || 'development',
    }),
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'secret',
      'token',
      'apiKey',
      '*.password',
      '*.secret',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
};

export function createLogger(service: string): pino.Logger {
  return pino({
    ...BASE_CONFIG,
    name: service,
    mixin: () => ({
      service,
      version: process.env.npm_package_version || '1.0.0',
    }),
  });
}
