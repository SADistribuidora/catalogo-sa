const { getStore } = require("@netlify/blobs");
const { verifyCookie } = require("./lib/auth-helper");

const PRODUCTS_STORE = "sa-catalogo";
const PRODUCTS_KEY = "products";

function blobStore(name) {
  return getStore({ name, siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
}

exports.handler = async (event) => {
  if (!verifyCookie(event.headers.cookie)) {
    return { statusCode: 401, body: JSON.stringify({ error: "Não autenticado" }) };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) };
  }

  const { produtoId, meliId } = body;
  if (!produtoId || !meliId) {
    return { statusCode: 400, body: JSON.stringify({ error: "produtoId e meliId são obrigatórios" }) };
  }

  const store = blobStore(PRODUCTS_STORE);
  const produtos = (await store.get(PRODUCTS_KEY, { type: "json" })) || [];
  const idx = produtos.findIndex((p) => p.id === Number(produtoId));
  if (idx === -1) {
    return { statusCode: 404, body: JSON.stringify({ error: "Produto não encontrado" }) };
  }

  produtos[idx].meliId = meliId;
  produtos[idx].meliSyncedAt = new Date().toISOString();
  await store.setJSON(PRODUCTS_KEY, produtos);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, produto: produtos[idx] }),
  };
};
