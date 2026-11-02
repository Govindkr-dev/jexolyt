const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const PHONE_PATTERN = /^\+[1-9]\d{9,14}$/;
const DEFAULT_SUPPORT_INBOX = "govindsh.dev@gmail.com";
const MAX_ESTIMATE_TOTAL = 10_000_000;

function validateProjectEstimate(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;

    const { name, email, phone, services, oneTimeTotal, monthlyTotal } = body;
    if (
        typeof name !== "string" || !name.trim() || name.trim().length > 100 ||
        typeof email !== "string" || email.length > 254 || !EMAIL_PATTERN.test(email.trim()) ||
        typeof phone !== "string" || !PHONE_PATTERN.test(phone) ||
        !Array.isArray(services) || services.length < 1 || services.length > 20 ||
        services.some(service => typeof service !== "string" || !service.trim() || service.trim().length > 100) ||
        !Number.isSafeInteger(oneTimeTotal) || oneTimeTotal < 0 || oneTimeTotal > MAX_ESTIMATE_TOTAL ||
        !Number.isSafeInteger(monthlyTotal) || monthlyTotal < 0 || monthlyTotal > MAX_ESTIMATE_TOTAL
    ) {
        return null;
    }

    return {
        name: name.trim().replace(/[\r\n]+/g, " "),
        email: email.trim().toLowerCase(),
        phone,
        services: services.map(service => service.trim().replace(/[\r\n]+/g, " ")),
        oneTimeTotal,
        monthlyTotal
    };
}

function createProjectEstimateHandler({ fetchImpl = globalThis.fetch, env = process.env } = {}) {
    return async function sendProjectEstimate(req, res) {
        const estimate = validateProjectEstimate(req.body);
        if (!estimate) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid name, email, mobile number, selected services, and estimate."
            });
        }

        const { RESEND_API_KEY, RESEND_FROM_EMAIL } = env;
        if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
            return res.status(503).json({
                success: false,
                message: "The estimate email service is not configured on the server."
            });
        }
        if (typeof fetchImpl !== "function") {
            return res.status(503).json({
                success: false,
                message: "The server email service is unavailable."
            });
        }

        const formatInr = amount => `₹${amount.toLocaleString("en-IN")}`;
        const lines = [
            "A client requested a JEXOLYT project estimate.",
            "",
            `Name: ${estimate.name}`,
            `Email: ${estimate.email}`,
            `Mobile: ${estimate.phone}`,
            "",
            "Selected services:",
            ...estimate.services.map(service => `- ${service}`),
            "",
            `Estimated one-time starting total: ${formatInr(estimate.oneTimeTotal)}`,
            `Recurring per month: ${formatInr(estimate.monthlyTotal)}`,
            "",
            "This is an initial estimate. Confirm final scope and pricing with the client."
        ];

        try {
            const response = await fetchImpl("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${RESEND_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    from: RESEND_FROM_EMAIL,
                    to: [env.SUPPORT_INBOX_EMAIL || DEFAULT_SUPPORT_INBOX],
                    reply_to: estimate.email,
                    subject: "New JEXOLYT project estimate request",
                    text: lines.join("\n")
                }),
                signal: AbortSignal.timeout(10_000)
            });

            if (!response.ok) {
                console.error("Project estimate email provider rejected the request:", response.status);
                return res.status(502).json({
                    success: false,
                    message: "Your estimate request could not be emailed. Please try again."
                });
            }

            return res.status(202).json({ success: true, message: "Estimate request emailed to JEXOLYT." });
        } catch (error) {
            console.error("Project estimate email delivery failed:", error.name);
            return res.status(502).json({
                success: false,
                message: "Your estimate request could not be emailed. Please try again."
            });
        }
    };
}

module.exports = { createProjectEstimateHandler, validateProjectEstimate };
