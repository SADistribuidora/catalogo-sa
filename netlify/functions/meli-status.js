const { getStore } = require("@netlify/blobs");
const { verifyCookie } = require("./lib/auth-helper");

const JOB_STORE = "sa-meli";

exports.handler = async (event) => {
  if (!verifyCookie(event.headers.cookie)) {
    return { statusCode: 401, body: JSON.stringify({ error: "Não autenticado" }) };
  }

  const tipo = (event.queryStringParameters || {}).tipo;
  const jobKey = tipo === "estoque" ? "stock-sync-status" : "job-status";

  const store = getStore({ name: JOB_STORE, siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN });
  const status = await store.get(jobKey, { type: "json" });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(status || { total: 0, processados: 0, publicados: 0, atualizados: 0, falhas: [], concluido: true }),
  };
};
