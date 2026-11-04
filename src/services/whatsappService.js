import config from '../config/index.js';

function resolvedProvider() {
  const p = config.whatsapp.provider;
  if (p === 'fonnte') return 'fonnte';
  if (p === 'cloud' || p === 'cloud_api' || p === 'meta') return 'cloud';
  if (p === 'twilio') return 'twilio';
  if (p === 'dev' || p === 'log') return 'dev';

  if (config.whatsapp.fonnteToken) return 'fonnte';
  if (config.whatsapp.cloudPhoneId && config.whatsapp.cloudToken) return 'cloud';
  if (
    config.whatsapp.twilioAccountSid &&
    config.whatsapp.twilioAuthToken &&
    config.whatsapp.twilioFrom
  ) {
    return 'twilio';
  }
  return 'dev';
}

export function whatsappConfigured() {
  return resolvedProvider() !== 'dev';
}

async function sendViaFonnte(phone, message) {
  const target = phone.replace(/^\+/, '');
  const body = new URLSearchParams({ target, message });
  const res = await fetch('https://api.fonnte.com/send', {
    method: 'POST',
    headers: {
      Authorization: config.whatsapp.fonnteToken,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`Fonnte HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (json && json.status === false) {
    throw new Error(`Fonnte: ${json.reason || text.slice(0, 200)}`);
  }
  return { sent: true, provider: 'fonnte' };
}

async function sendViaCloud(phone, code, message) {
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v22.0';
  const url = `https://graph.facebook.com/${version}/${config.whatsapp.cloudPhoneId}/messages`;

  let payload;
  if (config.whatsapp.cloudTemplate) {
    payload = {
      messaging_product: 'whatsapp',
      to: phone.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: config.whatsapp.cloudTemplate,
        language: { code: config.whatsapp.cloudTemplateLang },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: code }],
          },
        ],
      },
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      to: phone.replace(/^\+/, ''),
      type: 'text',
      text: { preview_url: false, body: message },
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.cloudToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WhatsApp Cloud HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return { sent: true, provider: 'cloud' };
}

async function sendViaTwilio(phone, message) {
  const sid = config.whatsapp.twilioAccountSid;
  const token = config.whatsapp.twilioAuthToken;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const body = new URLSearchParams({
    From: `whatsapp:${config.whatsapp.twilioFrom}`,
    To: `whatsapp:${phone}`,
    Body: message,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Twilio HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return { sent: true, provider: 'twilio' };
}

export async function sendWhatsAppMessage({ phone, message, code }) {
  const provider = resolvedProvider();

  if (provider === 'fonnte') return sendViaFonnte(phone, message);
  if (provider === 'cloud') return sendViaCloud(phone, code, message);
  if (provider === 'twilio') return sendViaTwilio(phone, message);

  console.log(`[whatsapp:dev] OTP untuk ${phone}: ${code}`);
  return { sent: false, provider: 'dev', devCode: code };
}
