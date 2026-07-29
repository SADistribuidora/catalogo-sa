const { getStore } = require("@netlify/blobs");
const { verifyCookie } = require("./lib/auth-helper");
const { getAccessTokenValido } = require("./lib/meli-tokens");
const { calcularPrecoComMargem } = require("./lib/meli-pricing");

const PRODUCTS_STORE = "sa-catalogo";
const PRODUCTS_KEY = "products";
const JOB_STORE = "sa-meli";
const JOB_KEY = "price-fix-status";

function blobStore(name) {
  return getStore({ name, siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
}

async function salvarStatus(status) {
  await blobStore(JOB_STORE).setJSON(JOB_KEY, status);
}

async function buscarItemML(meliId, token) {
  const res = await fetch(`https://api.mercadolibre.com/items/${meliId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function atualizarPrecoML(meliId, novoPreco, token) {
  const res = await fetch(`https://api.mercadolibre.com/items/${meliId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ price: novoPreco }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `HTTP ${res.status}`);
  }
}

exports.handler = async (event) => {
  if (!verifyCookie(event.headers.cookie)) {
    return { statusCode: 401, body: JSON.stringify({ error: "Não autenticado" }) };
  }

  const listingType = process.env.MELI_LISTING_TYPE || "gold_special";
  const productsStore = blobStore(PRODUCTS_STORE);
  const produtos = (await productsStore.get(PRODUCTS_KEY, { type: "json" })) || [];
  const publicados = produtos.filter((p) => p.meliId && Number(p.preco) > 0);

  const status = {
    iniciadoEm: new Date().toISOString(),
    total: publicados.length,
    processados: 0,
    corrigidos: 0,
    jaCorretos: 0,
    falhas: [],
    concluido: false,
  };
  await salvarStatus(status);

  if (publicados.length === 0) {
    status.concluido = true;
    await salvarStatus(status);
    return { statusCode: 200, body: JSON.stringify({ ok: true, mensagem: "Nenhum produto publicado no ML ainda" }) };
  }

  let token = await getAccessTokenValido();
  let renovarTokenEm = Date.now() + 5 * 60 * 1000;

  for (const p of publicados) {
    if (Date.now() > renovarTokenEm) {
      token = await getAccessTokenValido();
      renovarTokenEm = Date.now() + 5 * 60 * 1000;
    }
    try {
      const item = await buscarItemML(p.meliId, token);
      if (!item || !item.category_id) {
        status.falhas.push({ id: p.id, nome: p.nome, meliId: p.meliId, erro: "Não foi possível ler o anúncio no ML" });
      } else {
        const custo = Number(p.preco);
        const precoCorreto = await calcularPrecoComMargem(custo, item.category_id, listingType, token);
        // Só corrige se o preço atual estiver abaixo do necessário pra margem mínima
        if (Number(item.price) < precoCorreto - 0.01) {
          await atualizarPrecoML(p.meliId, precoCorreto, token);
          status.corrigidos++;
        } else {
          status.jaCorretos++;
        }
      }
    } catch (err) {
      status.falhas.push({ id: p.id, nome: p.nome, meliId: p.meliId, erro: err.message });
    }
    status.processados++;
    await salvarStatus(status);
    await new Promise((r) => setTimeout(r, 400));
  }

  status.concluido = true;
  await salvarStatus(status);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, total: publicados.length, corrigidos: status.corrigidos, jaCorretos: status.jaCorretos, falhas: status.falhas.length }),
  };
};
