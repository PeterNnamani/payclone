export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { accountNumber, bankCode } = req.body;

        if (!accountNumber || !bankCode) {
            return res.status(400).json({
                status: false,
                message: "Account number and bank code are required."
            });
        }

        const response = await fetch(
            `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
                }
            }
        );

        const data = await response.json();

        return res.status(response.status).json(data);

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            status: false,
            message: "Internal server error."
        });
    }
}