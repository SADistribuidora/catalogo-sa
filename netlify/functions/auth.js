const crypto = require("crypto");
const { verifyCookie, sign } = require("./lib/auth-helper");

const SESSION_HOURS = 12;

function makeCookie() {
  const expiry = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const sig = sign(expiry);
  const value = encodeURIComponent(`${expiry}.${sig}`);
  return `sa_admin=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) };
    }
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return { statusCode: 500, body: JSON.stringify({ error: "ADMIN_PASSWORD não configurada no servidor" }) };
    }
    if (body.password !== adminPassword) {
      return { statusCode: 401, body: JSON.stringify({ error: "Senha incorreta" }) };
    }
    return {
      statusCode: 200,
      headers: { "Set-Cookie": makeCookie(), "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  }

  if (event.httpMethod === "GET") {
    const ok = verifyCookie(event.headers.cookie);
    return { statusCode: 200, body: JSON.stringify({ authenticated: ok }) };
  }

  if (event.httpMethod === "DELETE") {
    return {
      statusCode: 200,
      headers: { "Set-Cookie": "sa_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" },
      body: JSON.stringify({ ok: true }),
    };
  }

  return { statusCode: 405, body: "Method not allowed" };
};
