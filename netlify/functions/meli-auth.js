const { verifyCookie } = require("./lib/auth-helper");

exports.handler = async (event) => {
  if (!verifyCookie(event.headers.cookie)) {
    return { statusCode: 401, body: "Não autenticado. Faça login no /admin primeiro, depois acesse este link na mesma aba do navegador." };
  }

  const appId = process.env.MELI_APP_ID;
  const redirectUri = process.env.MELI_REDIRECT_URI;

  if (!appId || !redirectUri) {
    return { statusCode: 500, body: "MELI_APP_ID ou MELI_REDIRECT_URI não configurados no Netlify." };
  }

  const url = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  return {
    statusCode: 302,
    headers: { Location: url },
    body: "",
  };
};
