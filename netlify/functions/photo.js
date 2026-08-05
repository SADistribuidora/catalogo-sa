const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");
const { verifyCookie } = require("./lib/auth-helper");

const STORE_NAME = "sa-fotos";
const PRODUCTS_STORE = "sa-catalogo";
const PRODUCTS_KEY = "products";

function chaveSyncValida(headerKey) {
  const esperado = process.env.SYNC_API_KEY || "";
  if (!esperado || !headerKey) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(headerKey), Buffer.from(esperado));
  } catch {
    return false;
  }
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const store = getStore({ name: STORE_NAME, siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });

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
    const headerKey = event.headers["x-sync-key"] || event.headers["X-Sync-Key"];
    const viaSync = chaveSyncValida(headerKey);
    if (!viaSync && !verifyCookie(event.headers.cookie)) {
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
    const fotoUrl = `/.netlify/functions/photo?id=${id}`;

    // Quando a chamada vem da sincronização automática, já atualiza o produto direto
    if (viaSync) {
      const productsStore = getStore({ name: PRODUCTS_STORE, siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
      const produtos = (await productsStore.get(PRODUCTS_KEY, { type: "json" })) || [];
      const idx = produtos.findIndex((p) => p.id === Number(id));
      if (idx !== -1) {
        produtos[idx].fotoUrl = fotoUrl;
        await productsStore.setJSON(PRODUCTS_KEY, produtos);
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, fotoUrl }),
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
