const { getStore } = require("@netlify/blobs");
const { verifyCookie } = require("./lib/auth-helper");
const { getAccessTokenValido } = require("./lib/meli-tokens");

const PRODUCTS_STORE = "sa-catalogo";
const PRODUCTS_KEY = "products";
const JOB_STORE = "sa-meli";
const JOB_KEY = "job-status";
const SITE_URL = "https://seadistribuidora.com.br";
const { calcularPrecoComMargem } = require("./lib/meli-pricing");

function blobStore(name) {
  return getStore({ name, siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
}

async function salvarStatus(status) {
  await blobStore(JOB_STORE).setJSON(JOB_KEY, status);
}

async function buscarCategoriaPorTexto(texto, token) {
  const url = `https://api.mercadolibre.com/sites/MLB/domain_discovery/search?limit=1&q=${encodeURIComponent(texto)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const errBody = await res.text();
    return { categoryId: null, erro: `HTTP ${res.status}: ${errBody.slice(0, 200)}` };
  }
  const data = await res.json();
  if (Array.isArray(data) && data[0] && data[0].category_id) {
    return { categoryId: data[0].category_id, erro: null };
  }
  return { categoryId: null, erro: null };
}

async function preverCategoria(titulo, categoriaInterna, token) {
  let r = await buscarCategoriaPorTexto(titulo, token);
  if (!r.categoryId && !r.erro && categoriaInterna) {
    r = await buscarCategoriaPorTexto(categoriaInterna, token);
  }
  return r;
}

async function atributosObrigatorios(categoryId, token) {
  const url = `https://api.mercadolibre.com/categories/${categoryId}/attributes`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const lista = await res.json();
  if (!Array.isArray(lista)) return [];
  return lista.filter((a) => a.tags && (a.tags.required || a.tags.catalog_required));
}

async function buscarProdutoCatalogo(categoryId, titulo, token) {
  const url = `https://api.mercadolibre.com/products/search?category_id=${categoryId}&q=${encodeURIComponent(titulo)}&limit=1&site_id=MLB`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json();
  const resultados = data.results || data;
  if (Array.isArray(resultados) && resultados[0] && resultados[0].id) {
    return resultados[0].id;
  }
  return null;
}

async function montarAtributos(categoryId, p, token) {
  const attributes = [{ id: "BRAND", value_name: p.marca || "Genérica" }];
  const obrigatorios = await atributosObrigatorios(categoryId, token);
  for (const attr of obrigatorios) {
    if (attributes.some((a) => a.id === attr.id)) continue;
    if (attr.id === "MODEL") {
      attributes.push({ id: "MODEL", value_name: p.sku || p.nome.slice(0, 30) });
    } else if (Array.isArray(attr.values) && attr.values.length > 0) {
      attributes.push({ id: attr.id, value_id: attr.values[0].id, value_name: attr.values[0].name });
    } else {
      attributes.push({ id: attr.id, value_name: "Não especificado" });
    }
  }
  return attributes;
}

async function criarItem(payload, token) {
  const res = await fetch("https://api.mercadolibre.com/items", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

function erroDetalhado(categoryId, data) {
  let msg = data.message || "Erro desconhecido";
  if (Array.isArray(data.cause) && data.cause.length) {
    const detalhes = data.cause.map((c) => c.message || c.code || JSON.stringify(c)).join(" | ");
    msg = `${msg}: ${detalhes}`;
  } else {
    msg = `${msg} — resposta completa: ${JSON.stringify(data).slice(0, 500)}`;
  }
  return `[categoria ${categoryId}] ${msg}`;
}

async function publicarProduto(p, token) {
  const previsao = await preverCategoria(p.nome, p.categoria, token);
  if (!previsao.categoryId) {
    const motivo = previsao.erro ? ` (erro na API: ${previsao.erro})` : "";
    throw new Error(`Não foi possível prever categoria no ML para este produto${motivo}`);
  }
  const categoryId = previsao.categoryId;

  const custo = Number(p.preco);
  if (!custo || custo <= 0) {
    throw new Error("Produto sem preço de custo válido");
  }
  const listingType = process.env.MELI_LISTING_TYPE || "gold_special";
  const preco = await calcularPrecoComMargem(custo, categoryId, listingType, token);

  const attributes = await montarAtributos(categoryId, p, token);
  const pictures = p.fotoUrl
    ? [{ source: p.fotoUrl.startsWith("http") ? p.fotoUrl : `${SITE_URL}${p.fotoUrl}` }]
    : [];
  const base = {
    category_id: categoryId,
    family_name: p.nome.slice(0, 40),
    price: preco,
    currency_id: "BRL",
    available_quantity: Math.max(1, Number(p.estoque) || 1),
    buying_mode: "buy_it_now",
    condition: "new",
    listing_type_id: listingType,
    attributes,
    pictures,
  };

  // Tentativa 1: fluxo clássico, com título livre
  let { ok, data } = await criarItem({ ...base, title: p.nome.slice(0, 60) }, token);

  // Se a categoria exigir catálogo (título rejeitado), tenta vincular a um produto do catálogo ML
  if (!ok && data.error && /title/i.test(data.error) && /invalid/i.test(data.message || "")) {
    const catalogProductId = await buscarProdutoCatalogo(categoryId, p.nome, token);
    if (!catalogProductId) {
      throw new Error(
        `[categoria ${categoryId}] Categoria exige catálogo do Mercado Livre e não foi encontrada correspondência para "${p.nome}" — precisa de revisão manual`
      );
    }
    ({ ok, data } = await criarItem({ ...base, catalog_product_id: catalogProductId }, token));
  }

  if (!ok) {
    throw new Error(erroDetalhado(categoryId, data));
  }

  // Se a categoria exigir compatibilidade de veículo e não tivermos essa informação,
  // declara exceção (sem veículo específico) pra não travar a publicação.
  try {
    await fetch(`https://api.mercadolibre.com/items/${data.id}/compatibilities/exception`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comment: "Peça genérica/multimarcas — compatibilidade não cadastrada no catálogo interno" }),
    });
  } catch {
    // Categoria pode não exigir isso; ignora se der erro
  }

  // Grava a descrição separadamente (exigência da API do ML)
  try {
    await fetch(`https://api.mercadolibre.com/items/${data.id}/description`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ plain_text: `${p.nome}\nCódigo: ${p.sku}\nMarca: ${p.marca}\nCategoria: ${p.categoria}` }),
    });
  } catch {
    // Não bloqueia a publicação se a descrição falhar
  }

  return data.id;
}

exports.handler = async (event) => {
  if (!verifyCookie(event.headers.cookie)) {
    return { statusCode: 401, body: JSON.stringify({ error: "Não autenticado" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) };
  }

  const productsStore = blobStore(PRODUCTS_STORE);
  const produtos = await productsStore.get(PRODUCTS_KEY, { type: "json" }) || [];

  let alvo;
  if (Array.isArray(body.ids) && body.ids.length > 0) {
    const idSet = new Set(body.ids.map(Number));
    alvo = produtos.filter((p) => idSet.has(p.id));
  } else if (body.all === true) {
    // Pula produtos que já foram publicados antes (evita duplicar anúncios)
    alvo = produtos.filter((p) => p.ativo && Number(p.preco) > 0 && !p.meliId);
  } else {
    return { statusCode: 400, body: JSON.stringify({ error: "Envie 'ids' (lista) ou 'all: true'" }) };
  }

  const totalAindaFaltando = produtos.filter((p) => p.ativo && Number(p.preco) > 0 && !p.meliId).length;

  const status = {
    iniciadoEm: new Date().toISOString(),
    total: alvo.length,
    processados: 0,
    publicados: 0,
    falhas: [],
    concluido: false,
    restantesNoCatalogoTodo: totalAindaFaltando,
  };
  await salvarStatus(status);

  // Netlify Background Function: a resposta HTTP já foi enviada ao cliente,
  // mas a execução continua rodando aqui por até 15 minutos.
  let token = await getAccessTokenValido();
  let renovarTokenEm = Date.now() + 5 * 60 * 1000;

  for (const p of alvo) {
    if (Date.now() > renovarTokenEm) {
      token = await getAccessTokenValido();
      renovarTokenEm = Date.now() + 5 * 60 * 1000;
    }
    try {
      const meliId = await publicarProduto(p, token);
      p.meliId = meliId;
      p.meliSyncedAt = new Date().toISOString();
      status.publicados++;
    } catch (err) {
      status.falhas.push({ id: p.id, nome: p.nome, erro: err.message });
    }
    status.processados++;
    await salvarStatus(status);
    await new Promise((r) => setTimeout(r, 400)); // evita limite de taxa da API
  }

  status.concluido = true;
  await salvarStatus(status);
  await productsStore.setJSON(PRODUCTS_KEY, produtos);

  return {
    statusCode: 202,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, total: alvo.length, publicados: status.publicados, falhas: status.falhas.length }),
  };
};
