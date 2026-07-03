import crypto from 'node:crypto';
import type { AstroCookies } from 'astro';
import { env } from './store';

export const SESSION_COOKIE = 'pk_session';
const SESSION_DAYS = 30;

export const DEFAULT_PASSWORD = 'popkorn';

function password(): string {
  return env('ADMIN_PASSWORD') || DEFAULT_PASSWORD;
}

export function usingDefaultPassword(): boolean {
  return !env('ADMIN_PASSWORD');
}

function secret(): Buffer {
  const configured = env('SESSION_SECRET');
  if (configured) return Buffer.from(configured);
  // Derive from the password so sessions invalidate when it changes.
  return crypto.createHash('sha256').update(`popkorn-session:${password()}`).digest();
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function checkPassword(attempt: string): boolean {
  const a = crypto.createHash('sha256').update(attempt).digest();
  const b = crypto.createHash('sha256').update(password()).digest();
  return crypto.timingSafeEqual(a, b);
}

export function createSessionToken(): string {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  return `${exp}.${sign(String(exp))}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = sign(exp);
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export function setSessionCookie(cookies: AstroCookies, url: URL): void {
  cookies.set(SESSION_COOKIE, createSessionToken(), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}
