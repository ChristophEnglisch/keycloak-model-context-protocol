/** Builds an unsigned JWT-shaped string; the admin client only decodes the payload. */
export function fakeJwt(expSeconds: number, extra: Record<string, unknown> = {}): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ exp: expSeconds, ...extra })}.sig`;
}
