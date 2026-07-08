const fs = require('fs');
const path = require('path');

loadEnvFile();

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const {
            recipientName,
            amount,
            note,
            bankName,
            accountNumber,
            bankCode,
            recipientPhoneNumber,
            transferType = 'bank',
            currency = 'NGN'
        } = req.body || {};

        const phone = normalizePhone(recipientPhoneNumber || derivePhoneFromAccount(accountNumber) || process.env.SMS_RECIPIENT_PHONE || process.env.RECIPIENT_SMS_PHONE || process.env.TEST_RECIPIENT_PHONE);

        if (!phone) {
            return res.status(400).json({
                status: false,
                message: 'No recipient phone number configured for SMS delivery.'
            });
        }

        const message = buildMessage({
            recipientName,
            amount,
            note,
            bankName,
            accountNumber,
            bankCode,
            transferType,
            currency
        });

        const provider = getConfiguredProvider();

        if (!provider) {
            return res.status(424).json({
                status: false,
                mode: 'unconfigured',
                message: 'No SMS provider is configured. Add Twilio, Termii, or Africa\'s Talking credentials to the environment to send real SMS.',
                phone,
                smsBody: message
            });
        }

        let smsResult;

        if (provider === 'twilio') {
            smsResult = await sendViaTwilio({
                to: phone,
                from: process.env.TWILIO_FROM,
                body: message
            });
        } else if (provider === 'termii') {
            smsResult = await sendViaTermii({
                to: phone,
                from: process.env.TERMII_SENDER_ID,
                body: message
            });
        } else if (provider === 'africas-talking') {
            smsResult = await sendViaAfricaSTalking({
                to: phone,
                body: message
            });
        }

        const providerError = getProviderErrorMessage(smsResult, provider);
        if (providerError) {
            return res.status(502).json({
                status: false,
                mode: 'live',
                provider,
                phone,
                message: providerError,
                smsBody: message,
                providerResponse: smsResult
            });
        }

        return res.status(200).json({
            status: true,
            mode: 'live',
            provider,
            phone,
            smsBody: message,
            providerResponse: smsResult
        });
    } catch (error) {
        console.error('SMS notification error:', error);
        return res.status(500).json({
            status: false,
            message: 'Failed to send SMS notification.'
        });
    }
};

function normalizePhone(value) {
    if (!value) return null;
    const digits = String(value).replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('234')) return `+${digits}`;
    if (digits.startsWith('0')) return `+234${digits.slice(1)}`;
    return `+${digits}`;
}

function loadEnvFile() {
    const envPath = path.resolve(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;

    const contents = fs.readFileSync(envPath, 'utf8');
    for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;
        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!process.env[key]) {
            process.env[key] = value;
        }
    }
}

function derivePhoneFromAccount(accountNumber) {
    const digits = String(accountNumber || '').replace(/\D/g, '');
    if (!digits) return null;
    const withZero = digits.startsWith('0') ? digits : `0${digits}`;
    return normalizePhone(withZero);
}

function buildMessage({ recipientName, amount, note, bankName, accountNumber, bankCode, transferType, currency }) {
    const safeName = recipientName || 'the recipient';
    const safeAmount = Number(amount || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 });
    const safeBank = bankName || 'a bank account';
    const safeAcct = accountNumber || 'your account';
    const safeNote = note || 'Transfer';
    return `Hello, ${safeName}. A ${transferType === 'payfair' ? 'wallet transfer' : 'payment'} of ${currency}${safeAmount} was sent to ${safeBank} (${safeAcct}). Reference: ${safeNote}.`;
}

function getConfiguredProvider() {
    const explicitProvider = (process.env.SMS_PROVIDER || '').toLowerCase();
    if (explicitProvider === 'twilio' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) return 'twilio';
    if (explicitProvider === 'termii' && process.env.TERMII_API_KEY && process.env.TERMII_SENDER_ID) return 'termii';
    if (explicitProvider === 'africas-talking' && process.env.AFRICAS_TALKING_USERNAME && process.env.AFRICAS_TALKING_API_KEY) return 'africas-talking';

    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) return 'twilio';
    if (process.env.TERMII_API_KEY && process.env.TERMII_SENDER_ID) return 'termii';
    if (process.env.AFRICAS_TALKING_USERNAME && process.env.AFRICAS_TALKING_API_KEY) return 'africas-talking';
    return null;
}

function getProviderErrorMessage(smsResult, provider) {
    if (!smsResult) return 'SMS provider did not return a response.';

    const data = smsResult.data || {};
    if (smsResult.status >= 400) {
        if (typeof data === 'string' && data) return data;
        if (data?.message) return data.message;
        if (data?.detail) return data.detail;
        if (data?.error) return data.error;
        if (provider === 'twilio') return 'Twilio rejected the SMS request.';
        if (provider === 'termii') return 'Termii rejected the SMS request.';
        if (provider === 'africas-talking') return 'Africa\'s Talking rejected the SMS request.';
    }

    if (data?.status === 'error' || data?.status === 'failed') {
        return data?.message || data?.error || 'SMS provider marked the message as failed.';
    }

    return null;
}

async function sendViaTwilio({ to, from, body }) {
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const params = new URLSearchParams({ To: to, From: from, Body: body });
    const response = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + process.env.TWILIO_ACCOUNT_SID + '/Messages.json', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    });

    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
}

async function sendViaTermii({ to, from, body }) {
    const response = await fetch('https://api.ng.termii.com/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            api_key: process.env.TERMII_API_KEY,
            to,
            from,
            sms: body,
            type: 'plain'
        })
    });

    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
}

async function sendViaAfricaSTalking({ to, body }) {
    const response = await fetch('https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            apikey: process.env.AFRICAS_TALKING_API_KEY
        },
        body: new URLSearchParams({
            username: process.env.AFRICAS_TALKING_USERNAME,
            to,
            message: body
        })
    });

    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
}
