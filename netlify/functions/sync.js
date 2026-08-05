const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

const STORE_NAME = "sa-catalogo";
const KEY = "products";
const initialProducts = require("./initial-products.json");

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

function chaveValida(headerKey) {
  const esperado = process.env.SYNC_API_KEY || "";
  if (!esperado || !headerKey) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(headerKey), Buffer.from(esperado));
  } catch {
    return false;
  }
}

async function loadProducts(store) {
  const raw = await store.get(KEY, { type: "json" });
  if (raw) return raw;
  await store.setJSON(KEY, initialProducts);
  return initialProducts;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const headerKey = event.headers["x-sync-key"] || event.headers["X-Sync-Key"];
  if (!chaveValida(headerKey)) {
    return jsonResponse(401, { error: "Chave de sincronização inválida" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "JSON inválido" });
  }

  const itens = body.produtos;
  if (!Array.isArray(itens)) {
    return jsonResponse(400, { error: "Campo 'produtos' deve ser uma lista" });
  }

  const store = getStore({ name: STORE_NAME, siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
  const products = await loadProducts(store);
  const porId = new Map(products.map((p) => [p.id, p]));

  let atualizados = 0;
  let novos = 0;
  const novosIds = [];

  for (const item of itens) {
    const id = Number(item.id);
    if (!id) continue;

    if (porId.has(id)) {
      // Produto já existe: só atualiza estoque (e preço, se vier)
      const atual = porId.get(id);
      atual.estoque = Number(item.estoque) || 0;
      if (item.preco !== undefined) atual.preco = Number(item.preco) || atual.preco;
      atualizados++;
    } else {
      // Produto novo: adiciona com os dados enviados
      const novo = {
        id,
        nome: item.nome || "Produto sem nome",
        sku: item.sku || `PRD-${String(id).padStart(5, "0")}`,
        categoria: item.categoria || "Geral",
        marca: item.marca || "Diversos",
        preco: Number(item.preco) || 0,
        estoque: Number(item.estoque) || 0,
        ativo: true,
        fotoUrl: item.fotoUrl || null,
      };
      porId.set(id, novo);
      novos++;
      novosIds.push(id);
    }
  }

  const listaFinal = Array.from(porId.values());
  await store.setJSON(KEY, listaFinal);

  // Dispara a sincronização de estoque com o Mercado Livre em segundo plano
  // (não espera terminar — a function em background responde rápido e continua sozinha)
  try {
    const baseUrl = `https://${event.headers.host}`;
    fetch(`${baseUrl}/.netlify/functions/meli-stock-sync-background`, {
      method: "POST",
      headers: { "X-Sync-Key": headerKey },
    }).catch(() => {});
  } catch {
    // Não bloqueia a resposta principal se isso falhar
  }

  return jsonResponse(200, {
    ok: true,
    recebidos: itens.length,
    atualizados,
    novos,
    novosIds,
    totalNoSite: listaFinal.length,
  });
};
