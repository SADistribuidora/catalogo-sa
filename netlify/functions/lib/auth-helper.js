const crypto = require("crypto");

function sign(expiry) {
  const secret = process.env.ADMIN_PASSWORD || "";
  return crypto.createHmac("sha256", secret).update(String(expiry)).digest("hex");
}

function verifyCookie(cookieHeader) {
  if (!cookieHeader) return false;
  const match = cookieHeader.match(/sa_admin=([^;]+)/);
  if (!match) return false;
  const [expiryStr, sig] = decodeURIComponent(match[1]).split(".");
  const expiry = Number(expiryStr);
  if (!expiry || Date.now() > expiry) return false;
  const expected = sign(expiry);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

module.exports = { verifyCookie, sign };
