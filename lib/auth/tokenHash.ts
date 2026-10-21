/**
 * Session tokens are stored hashed: the cookie holds the random token, the
 * database holds only its SHA-256, and lookups hash the cookie value first.
 * A read of the session tables is then not enough to sign in as anyone.
 */
import { createHash, randomBytes } from 'crypto';

/** 32 random bytes, base64url: the value that goes in the cookie. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Hex SHA-256 of a cookie token: the value stored in Session.token. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
