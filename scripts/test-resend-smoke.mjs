/**
 * scripts/test-resend-smoke.mjs
 *
 * One-shot smoke test — verifies that:
 *   1. SMTP_PASSWORD (Resend API key) is valid.
 *   2. EMAIL_FROM_ADDRESS is on a verified domain in the Resend account.
 *   3. Resend accepts the send request end-to-end.
 *
 * Uses the Resend REST API (no nodemailer dependency required).
 *
 * Usage:
 *   cd TimttoApp
 *   node scripts/test-resend-smoke.mjs your-email@example.com
 *
 * Requires `.env` in TimttoApp/ with:
 *   SMTP_PASSWORD, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME
 */
import 'dotenv/config';

const to = process.argv[2];
if (!to) {
  console.error('❌  Falta el email de destino.');
  console.error('    Uso: node scripts/test-resend-smoke.mjs tu-email@example.com');
  process.exit(1);
}

const apiKey = process.env.SMTP_PASSWORD;
const fromAddress = process.env.EMAIL_FROM_ADDRESS;
const fromName = process.env.EMAIL_FROM_NAME || 'TIMTTO';

if (!apiKey) {
  console.error('❌  SMTP_PASSWORD no encontrada en .env');
  process.exit(1);
}
if (!fromAddress) {
  console.error('❌  EMAIL_FROM_ADDRESS no encontrada en .env');
  process.exit(1);
}

console.log('🔧  Config detectada:');
console.log(`    From      : ${fromName} <${fromAddress}>`);
console.log(`    To        : ${to}`);
console.log(`    API key   : ${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)} (${apiKey.length} chars)`);
console.log('');
console.log('📤  Enviando via Resend REST API...');

try {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName} <${fromAddress}>`,
      to,
      subject: '✅ E3 smoke test — Resend + timtto.com',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #0d6efd;">Setup correcto ✅</h2>
          <p>Si ves este email es porque:</p>
          <ul>
            <li>Resend acepta tu API key</li>
            <li><code>timtto.com</code> está verificado (SPF + DKIM firmados)</li>
            <li>La dirección <code>${fromAddress}</code> es válida</li>
            <li>El email llegó (revisa header: no debería decir "via gmail.com")</li>
          </ul>
          <p style="color: #666; font-size: 12px;">
            Smoke test — puedes borrar este correo.
          </p>
        </div>
      `,
      text: `Setup correcto. Si ves este email, Resend + timtto.com están bien configurados.`,
    }),
  });

  const data = await response.json();

  if (response.ok) {
    console.log(`✅  HTTP ${response.status} — envío aceptado por Resend`);
    console.log(`📬  Message ID: ${data.id || 'sin id'}`);
    console.log('');
    console.log('👀  Revisa la bandeja de entrada de ' + to + ' en los próximos 30 segundos.');
    console.log('    Si NO llega, revisa la carpeta de spam.');
    console.log('    Si tampoco está en spam, algo pasa con la deliverability.');
  } else {
    console.error(`❌  HTTP ${response.status} — Resend rechazó el envío`);
    console.error('    Detalle:', JSON.stringify(data, null, 2));
    console.error('');
    console.error('    Errores comunes:');
    console.error('    - 401 → API key inválida o expirada');
    console.error('    - 403 → API key no tiene permisos "Sending access"');
    console.error('    - 422 "domain is not verified" → completa la verificación DNS en Resend');
    console.error('    - 422 "from address" → EMAIL_FROM_ADDRESS no coincide con dominio verificado');
    process.exit(1);
  }
} catch (err) {
  console.error('❌  Error de red al llamar Resend:', err.message);
  console.error('    Verifica tu conexión a internet y que api.resend.com sea alcanzable.');
  process.exit(1);
}
