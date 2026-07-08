const KNOWN_RECIPIENTS = {
  '058:0123456789': '+2347012345678',
  '058:1234567890': '+2347030000123',
  '044:0000000000': '+2348055550000',
  '999992:08012345678': '+2348131112233'
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { accountNumber, bankCode, recipientName, bankName, phone } = req.body || {};
    const resolvedPhone = resolveRecipientPhone({
      accountNumber,
      bankCode,
      recipientName,
      bankName,
      phone
    });

    return res.status(200).json({
      status: true,
      phone: resolvedPhone,
      source: resolvedPhone ? 'lookup' : 'none',
      accountNumber: accountNumber || '',
      bankCode: bankCode || ''
    });
  } catch (error) {
    console.error('Recipient phone lookup error:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to resolve recipient phone number.'
    });
  }
};

function resolveRecipientPhone({ accountNumber, bankCode, recipientName, bankName, phone }) {
  const providedPhone = normalizePhone(phone);
  if (providedPhone) return providedPhone;

  const normalizedAccount = String(accountNumber || '').trim();
  const normalizedBankCode = String(bankCode || '').trim();
  const key = `${normalizedBankCode}:${normalizedAccount}`;

  const envMap = parseEnvMap(process.env.RECIPIENT_PHONE_MAP);
  const envMatch = envMap[key] || envMap[normalizedAccount] || envMap[`${bankName || ''}:${normalizedAccount}`];
  if (envMatch) return normalizePhone(envMatch);

  if (KNOWN_RECIPIENTS[key]) return normalizePhone(KNOWN_RECIPIENTS[key]);

  const accountPhone = derivePhoneFromAccount(normalizedAccount);
  if (accountPhone) return accountPhone;

  return normalizePhone(process.env.DEFAULT_RECIPIENT_PHONE || process.env.SMS_RECIPIENT_PHONE || process.env.RECIPIENT_SMS_PHONE || process.env.TEST_RECIPIENT_PHONE);
}

function normalizePhone(value) {
  if (!value) return '';
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('234')) return `+${digits}`;
  if (digits.startsWith('0')) return `+234${digits.slice(1)}`;
  return `+${digits}`;
}

function derivePhoneFromAccount(accountNumber) {
  const digits = String(accountNumber || '').replace(/\D/g, '');
  if (!digits) return '';
  const withZero = digits.startsWith('0') ? digits : `0${digits}`;
  return normalizePhone(withZero);
}

function parseEnvMap(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

module.exports.resolveRecipientPhone = resolveRecipientPhone;
