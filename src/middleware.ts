import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE, verifySessionToken } from './lib/auth';

export const onRequest = defineMiddleware((context, next) => {
  const { cookies, url, redirect } = context;
  const path = url.pathname;
  const authed = verifySessionToken(cookies.get(SESSION_COOKIE)?.value);
  context.locals.authed = authed;

  if (path.startsWith('/api/') && path !== '/api/auth' && !authed) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (path.startsWith('/admin') && path !== '/admin/login' && !authed) {
    return redirect('/admin/login');
  }
  if (path === '/admin/login' && authed) {
    return redirect('/admin');
  }

  return next();
});
