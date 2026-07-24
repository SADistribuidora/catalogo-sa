const { getStore } = require("@netlify/blobs");

const STORE_NAME = "sa-meli";
const KEY = "tokens";

function tokenStore() {
  return getStore({ name: STORE_NAME, siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
}

async function salvarTokens(dados) {
  const store = tokenStore();
  const registro = {
    access_token: dados.access_token,
    refresh_token: dados.refresh_token,
    user_id: dados.user_id,
    obtido_em: Date.now(),
    expira_em: Date.now() + (dados.expires_in - 300) * 1000, // 5 min de folga
  };
  await store.setJSON(KEY, registro);
  return registro;
}

async function lerTokens() {
  const store = tokenStore();
  return await store.get(KEY, { type: "json" });
}

async function trocarCodePorToken(code) {
  const res = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.MELI_APP_ID,
      client_secret: process.env.MELI_CLIENT_SECRET,
      code,
      redirect_uri: process.env.MELI_REDIRECT_URI,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Erro ao trocar code por token: ${JSON.stringify(data)}`);
  return salvarTokens(data);
}

async function renovarToken(refresh_token) {
  const res = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.MELI_APP_ID,
      client_secret: process.env.MELI_CLIENT_SECRET,
      refresh_token,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Erro ao renovar token: ${JSON.stringify(data)}`);
  return salvarTokens(data);
}

async function getAccessTokenValido() {
  let tokens = await lerTokens();
  if (!tokens) {
    throw new Error("Nenhuma conexão com o Mercado Livre encontrada. Autorize primeiro via /.netlify/functions/meli-auth");
  }
  if (Date.now() > tokens.expira_em) {
    tokens = await renovarToken(tokens.refresh_token);
  }
  return tokens.access_token;
}

module.exports = { trocarCodePorToken, getAccessTokenValido, lerTokens };
