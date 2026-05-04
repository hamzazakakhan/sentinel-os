declare module 'speakeasy' {
  interface GenerateSecretOptions {
    name?: string;
    length?: number;
    symbols?: boolean;
    otpauth_url?: boolean;
    issuer?: string;
  }
  interface TotpOptions {
    secret: string;
    encoding?: string;
    step?: number;
    window?: number;
    time?: number;
  }
  interface VerifyOptions extends TotpOptions {
    token: string;
  }
  interface OtpauthURLOptions {
    secret: string;
    label?: string;
    issuer?: string;
    encoding?: string;
    step?: number;
    algorithm?: string;
  }
  const totp: {
    (options: TotpOptions): string;
    verify(options: VerifyOptions): boolean;
  };
  function generateSecret(options?: GenerateSecretOptions): { base32: string; otpauth_url?: string; ascii?: string; hex?: string };
  function otpauthURL(options: OtpauthURLOptions): string;
}

declare module 'qrcode' {
  export function toDataURL(text: string, options?: { width?: number; margin?: number }): Promise<string>;
  export function toString(text: string, options?: { type?: string }): Promise<string>;
}
