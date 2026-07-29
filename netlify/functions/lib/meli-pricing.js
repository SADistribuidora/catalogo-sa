const MARKUP = 1.4; // chute inicial, o preço final é ajustado pela taxa real do ML
const MARGEM_MINIMA = 0.20; // margem líquida mínima garantida após a taxa do Mercado Livre

async function consultarTaxaML(preco, categoryId, listingType, token) {
  const url = `https://api.mercadolibre.com/sites/MLB/listing_prices?price=${preco}&category_id=${categoryId}&listing_type_id=${listingType}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json();
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry || typeof entry.sale_fee_amount !== "number") return null;
  return entry.sale_fee_amount;
}

async function calcularPrecoComMargem(custo, categoryId, listingType, token) {
  let preco = Math.round(custo * MARKUP * 100) / 100;
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const taxa = await consultarTaxaML(preco, categoryId, listingType, token);
    if (taxa === null) {
      return preco;
    }
    const liquido = preco - taxa;
    const margemAtual = (liquido - custo) / custo;
    if (margemAtual >= MARGEM_MINIMA) {
      return preco;
    }
    const faltaCobrir = custo * (1 + MARGEM_MINIMA) - liquido;
    preco = Math.round((preco + faltaCobrir) * 100) / 100;
  }
  return preco;
}

module.exports = { MARKUP, MARGEM_MINIMA, consultarTaxaML, calcularPrecoComMargem };
