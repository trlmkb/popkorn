import type { APIRoute } from 'astro';
import { checkPassword, clearSessionCookie, setSessionCookie } from '../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url }) => {
  let attempt = '';
  try {
    const body = (await request.json()) as { password?: string };
    attempt = body.password ?? '';
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (!checkPassword(attempt)) {
    return json({ error: 'wrong password' }, 401);
  }
  setSessionCookie(cookies, url);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ cookies }) => {
  clearSessionCookie(cookies);
  return json({ ok: true });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
