// keepalive: a trivial, unauthenticated, read-nothing endpoint
// whose only purpose is to generate API traffic so the Supabase
// Free-tier project does not auto-pause after 7 days of
// inactivity (see docs/architecture.md section 3). Called once
// daily by .github/workflows/keepalive.yml.
//
// Deliberately does not touch any table, does not accept input,
// and returns no information about the project's contents.

Deno.serve(() => {
  return new Response(JSON.stringify({ status: "ok" }), {
    headers: { "content-type": "application/json" },
  });
});
