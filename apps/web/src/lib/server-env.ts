// Server-side runtime env for the web app. All values are read at request
// time (no NEXT_PUBLIC_ bake-in), so one Docker image works for any
// deployment target.
//
//   API_URL         — where server actions / server components reach the
//                     Fastify API. In compose this is the internal address
//                     (http://api:3001).
//   API_PUBLIC_URL  — the browser-facing origin of the API, used for the
//                     one flow that redirects the user's browser to the API
//                     directly (Google OAuth begin). Defaults to API_URL.

export function apiUrl(): string {
  return (
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ?? // pre-fork compat
    'http://localhost:3001'
  );
}

export function apiPublicUrl(): string {
  return process.env.API_PUBLIC_URL ?? apiUrl();
}
