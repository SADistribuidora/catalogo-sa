const { getStore } = require("@netlify/blobs");
const { verifyCookie } = require("./lib/auth-helper");

const STORE_NAME = "sa-fotos";

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const store = getStore(STORE_NAME);

  if (event.httpMethod === "GET") {
    const id = qs.id;
    if (!id) return { statusCode: 400, body: "id é obrigatório" };
    const blob = await store.get(id, { type: "arrayBuffer" });
    if (!blob) return { statusCode: 404, body: "Foto não encontrada" };
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
      body: Buffer.from(blob).toString("base64"),
      isBase64Encoded: true,
    };
  }

  if (event.httpMethod === "POST") {
    if (!verifyCookie(event.headers.cookie)) {
      return { statusCode: 401, body: JSON.stringify({ error: "Não autenticado" }) };
    }
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) };
    }
    const { id, imageBase64 } = body;
    if (!id || !imageBase64) {
      return { statusCode: 400, body: JSON.stringify({ error: "id e imageBase64 são obrigatórios" }) };
    }
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    await store.set(String(id), buffer);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, fotoUrl: `/.netlify/functions/photo?id=${id}` }),
    };
  }

  if (event.httpMethod === "DELETE") {
    if (!verifyCookie(event.headers.cookie)) {
      return { statusCode: 401, body: JSON.stringify({ error: "Não autenticado" }) };
    }
    const id = qs.id;
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: "id é obrigatório" }) };
    await store.delete(id);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, body: "Method not allowed" };
};
