const { trocarCodePorToken } = require("./lib/meli-tokens");

exports.handler = async (event) => {
  const code = (event.queryStringParameters || {}).code;

  if (!code) {
    return { statusCode: 400, body: "Código de autorização não recebido. Tente novamente pelo link /.netlify/functions/meli-auth" };
  }

  try {
    await trocarCodePorToken(code);
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Conectado</title></head>
<body style="font-family:sans-serif; text-align:center; padding:60px;">
  <h1 style="color:#479A4A;">✅ Conectado ao Mercado Livre!</h1>
  <p>A conexão foi salva com sucesso. Você já pode fechar esta aba.</p>
  <p><a href="/admin/">Voltar para o admin</a></p>
</body></html>`,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: `<h1>Erro ao conectar</h1><pre>${err.message}</pre>`,
    };
  }
};
