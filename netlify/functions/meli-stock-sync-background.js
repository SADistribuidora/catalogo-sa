const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");
const { getAccessTokenValido } = require("./lib/meli-tokens");
const { verifyCookie } = require("./lib/auth-helper");

const PRODUCTS_STORE = "sa-catalogo";
const PRODUCTS_KEY = "products";
const JOB_STORE = "sa-meli";
const JOB_KEY = "stock-sync-status";

function blobStore(name) {
  return getStore({ name, siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
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

async function salvarStatus(status) {
  await blobStore(JOB_STORE).setJSON(JOB_KEY, status);
}

async function atualizarEstoqueItem(meliId, quantidade, token) {
  const res = await fetch(`https://api.mercadolibre.com/items/${meliId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ available_quantity: Math.max(0, Number(quantidade) || 0) }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `HTTP ${res.status}`);
  }
}

exports.handler = async (event) => {
  const headerKey = event.headers["x-sync-key"] || event.headers["X-Sync-Key"];
  const autorizado = chaveValida(headerKey) || verifyCookie(event.headers.cookie);
  if (!autorizado) {
    return { statusCode: 401, body: JSON.stringify({ error: "Não autorizado" }) };
  }

  const productsStore = blobStore(PRODUCTS_STORE);
  const produtos = (await productsStore.get(PRODUCTS_KEY, { type: "json" })) || [];
  const publicados = produtos.filter((p) => p.meliId);

  const status = {
    iniciadoEm: new Date().toISOString(),
    total: publicados.length,
    processados: 0,
    atualizados: 0,
    falhas: [],
    concluido: false,
  };
  await salvarStatus(status);

  if (publicados.length === 0) {
    status.concluido = true;
    await salvarStatus(status);
    return { statusCode: 200, body: JSON.stringify({ ok: true, mensagem: "Nenhum produto publicado no ML ainda" }) };
  }

  // Background Function: resposta HTTP já foi enviada, execução continua por até 15 min
  let token = await getAccessTokenValido();
  let renovarTokenEm = Date.now() + 5 * 60 * 1000;

  for (const p of publicados) {
    if (Date.now() > renovarTokenEm) {
      token = await getAccessTokenValido();
      renovarTokenEm = Date.now() + 5 * 60 * 1000;
    }
    try {
      await atualizarEstoqueItem(p.meliId, p.estoque, token);
      status.atualizados++;
    } catch (err) {
      status.falhas.push({ id: p.id, nome: p.nome, meliId: p.meliId, erro: err.message });
    }
    status.processados++;
    await salvarStatus(status);
    await new Promise((r) => setTimeout(r, 300));
  }

  status.concluido = true;
  await salvarStatus(status);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, total: publicados.length, atualizados: status.atualizados, falhas: status.falhas.length }),
  };
};
