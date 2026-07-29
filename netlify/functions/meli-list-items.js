const { getStore } = require("@netlify/blobs");
const { verifyCookie } = require("./lib/auth-helper");
const { getAccessTokenValido, lerTokens } = require("./lib/meli-tokens");

const PRODUCTS_STORE = "sa-catalogo";
const PRODUCTS_KEY = "products";

function blobStore(name) {
  return getStore({ name, siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
}

async function listarTodosOsIds(userId, token) {
  const ids = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const url = `https://api.mercadolibre.com/users/${userId}/items/search?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) break;
    const data = await res.json();
    const results = data.results || [];
    ids.push(...results);
    if (results.length < limit) break;
    offset += limit;
    if (offset > 2000) break; // limite de segurança
  }
  return ids;
}

async function buscarDetalhes(ids, token) {
  const detalhes = [];
  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20);
    const url = `https://api.mercadolibre.com/items?ids=${lote.join(",")}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) continue;
    const data = await res.json();
    for (const entry of data) {
      if (entry.code === 200 && entry.body) {
        const item = entry.body;
        const skuAttr = (item.attributes || []).find((a) => a.id === "SELLER_SKU");
        detalhes.push({
          meliId: item.id,
          titulo: item.title,
          sku: item.seller_custom_field || (skuAttr && skuAttr.value_name) || null,
          preco: item.price,
          foto: item.thumbnail || (item.pictures && item.pictures[0] && item.pictures[0].url) || null,
        });
      }
    }
  }
  return detalhes;
}

exports.handler = async (event) => {
  if (!verifyCookie(event.headers.cookie)) {
    return { statusCode: 401, body: JSON.stringify({ error: "Não autenticado" }) };
  }

  const tokens = await lerTokens();
  if (!tokens || !tokens.user_id) {
    return { statusCode: 400, body: JSON.stringify({ error: "Conecte a conta do Mercado Livre primeiro" }) };
  }

  const token = await getAccessTokenValido();
  const ids = await listarTodosOsIds(tokens.user_id, token);
  const anuncios = await buscarDetalhes(ids, token);

  const productsStore = blobStore(PRODUCTS_STORE);
  const produtos = (await productsStore.get(PRODUCTS_KEY, { type: "json" })) || [];
  const porSku = new Map(produtos.filter((p) => p.sku).map((p) => [p.sku.trim().toUpperCase(), p]));
  const meliIdsJaVinculados = new Set(produtos.filter((p) => p.meliId).map((p) => p.meliId));

  const resultado = anuncios.map((a) => {
    if (meliIdsJaVinculados.has(a.meliId)) {
      return { ...a, status: "ja_vinculado" };
    }
    if (a.sku) {
      const match = porSku.get(a.sku.trim().toUpperCase());
      if (match) {
        return { ...a, status: "match_automatico", produtoId: match.id, produtoNome: match.nome };
      }
    }
    return { ...a, status: "sem_match" };
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total: resultado.length, anuncios: resultado }),
  };
};
