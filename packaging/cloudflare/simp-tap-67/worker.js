/**
 * SIMP Stateless SoundCloud OAuth 2.1 Token Proxy (Cloudflare Worker)
 * Deployed URL: https://simp-tap-67.niiiitz.workers.dev
 *
 * Keeps `SOUNDCLOUD_CLIENT_SECRET` strictly in Cloudflare's encrypted environment secrets
 * so distributed SIMP binaries never embed `client_secret` in `.rodata`.
 *
 * Required Cloudflare Worker Environment Variables / Secrets:
 * - `SOUNDCLOUD_CLIENT_ID`
 * - `SOUNDCLOUD_CLIENT_SECRET` (Secret)
 */
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Accept",
        },
      });
    }

    if (request.method !== "POST") {
      return Response.json(
        { error: "method_not_allowed", error_description: "POST required" },
        { status: 405 }
      );
    }

    const clientId = (env.SOUNDCLOUD_CLIENT_ID || "").trim();
    const clientSecret = (env.SOUNDCLOUD_CLIENT_SECRET || "").trim();
    if (!clientId || !clientSecret) {
      return Response.json(
        { error: "server_misconfigured", error_description: "Worker missing SoundCloud credentials" },
        { status: 500 }
      );
    }

    let incomingParams;
    try {
      const bodyText = await request.text();
      incomingParams = new URLSearchParams(bodyText);
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const grantType = (incomingParams.get("grant_type") || "").trim();
    const allowedGrants = new Set([
      "authorization_code",
      "refresh_token",
      "client_credentials",
    ]);

    if (!allowedGrants.has(grantType)) {
      return Response.json(
        { error: "unsupported_grant_type" },
        { status: 400 }
      );
    }

    const upstreamParams = new URLSearchParams();
    upstreamParams.set("grant_type", grantType);
    upstreamParams.set("client_id", clientId);
    upstreamParams.set("client_secret", clientSecret);

    if (grantType === "authorization_code") {
      const code = incomingParams.get("code") || "";
      const redirectUri = incomingParams.get("redirect_uri") || "";
      const codeVerifier = incomingParams.get("code_verifier") || "";
      if (!code || !redirectUri || !codeVerifier) {
        return Response.json(
          { error: "invalid_request", error_description: "Missing PKCE parameters" },
          { status: 400 }
        );
      }
      upstreamParams.set("code", code);
      upstreamParams.set("redirect_uri", redirectUri);
      upstreamParams.set("code_verifier", codeVerifier);
    } else if (grantType === "refresh_token") {
      const refreshToken = incomingParams.get("refresh_token") || "";
      if (!refreshToken) {
        return Response.json(
          { error: "invalid_request", error_description: "Missing refresh_token" },
          { status: 400 }
        );
      }
      upstreamParams.set("refresh_token", refreshToken);
    }

    const basicAuth = btoa(`${clientId}:${clientSecret}`);
    const upstreamResponse = await fetch("https://secure.soundcloud.com/oauth/token", {
      method: "POST",
      headers: {
        "Accept": "application/json; charset=utf-8",
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${basicAuth}`,
      },
      body: upstreamParams.toString(),
    });

    const responseBody = await upstreamResponse.text();
    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};
