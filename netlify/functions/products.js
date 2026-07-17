const { getStore } = require("@netlify/blobs");
const { verifyCookie } = require("./lib/auth-helper");
const initialProducts = require("./initial-products.json");

const STORE_NAME = "sa-catalogo";
const KEY = "products";

async function loadProducts() {
  const store = getStore(STORE_NAME);
  const raw = await store.get(KEY, { type: "json" });
  if (raw) return raw;
  // Primeira vez: semeia com os dados iniciais
  await store.setJSON(KEY, initialProducts);
  return initialProducts;
}

async function saveProducts(products) {
  const store = getStore(STORE_NAME);
  await store.setJSON(KEY, products);
}

function jsonResponse(statusCode, data, extraHeaders) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...(extraHeaders || {}) },
    body: JSON.stringify(data),
  };
}

exports.handler = async (event) => {
  const isAuthed = verifyCookie(event.headers.cookie);
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === "GET") {
    const all = await loadProducts();
    if (qs.all === "1") {
      if (!isAuthed) return jsonResponse(401, { error: "Não autenticado" });
      return jsonResponse(200, all);
    }
    // Público: só produtos ativos, sem o campo preco
    const publicos = all
      .filter((p) => p.ativo)
      .map(({ preco, ativo, ...rest }) => rest);
    return jsonResponse(200, publicos);
  }

  if (!isAuthed) {
    return jsonResponse(401, { error: "Não autenticado" });
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return jsonResponse(400, { error: "JSON inválido" });
    }
    const products = await loadProducts();
    const nextId = products.reduce((max, p) => Math.max(max, p.id), 0) + 1;
    const novo = {
      id: nextId,
      nome: body.nome || "Produto sem nome",
      sku: body.sku || `PRD-${String(nextId).padStart(5, "0")}`,
      categoria: body.categoria || "Geral",
      marca: body.marca || "Diversos",
      preco: Number(body.preco) || 0,
      estoque: Number(body.estoque) || 0,
      ativo: body.ativo !== undefined ? !!body.ativo : true,
      fotoUrl: body.fotoUrl || null,
    };
    products.push(novo);
    await saveProducts(products);
    return jsonResponse(201, novo);
  }

  if (event.httpMethod === "PUT") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return jsonResponse(400, { error: "JSON inválido" });
    }
    if (!body.id) return jsonResponse(400, { error: "id é obrigatório" });
    const products = await loadProducts();
    const idx = products.findIndex((p) => p.id === Number(body.id));
    if (idx === -1) return jsonResponse(404, { error: "Produto não encontrado" });
    const atual = products[idx];
    const atualizado = {
      ...atual,
      ...("nome" in body ? { nome: body.nome } : {}),
      ...("sku" in body ? { sku: body.sku } : {}),
      ...("categoria" in body ? { categoria: body.categoria } : {}),
      ...("marca" in body ? { marca: body.marca } : {}),
      ...("preco" in body ? { preco: Number(body.preco) } : {}),
      ...("estoque" in body ? { estoque: Number(body.estoque) } : {}),
      ...("ativo" in body ? { ativo: !!body.ativo } : {}),
      ...("fotoUrl" in body ? { fotoUrl: body.fotoUrl } : {}),
    };
    products[idx] = atualizado;
    await saveProducts(products);
    return jsonResponse(200, atualizado);
  }

  if (event.httpMethod === "DELETE") {
    const id = Number(qs.id);
    if (!id) return jsonResponse(400, { error: "id é obrigatório" });
    const products = await loadProducts();
    const filtrados = products.filter((p) => p.id !== id);
    if (filtrados.length === products.length) {
      return jsonResponse(404, { error: "Produto não encontrado" });
    }
    await saveProducts(filtrados);
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(405, { error: "Method not allowed" });
};
