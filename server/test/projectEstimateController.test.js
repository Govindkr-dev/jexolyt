const test = require("node:test");
const assert = require("node:assert/strict");
const { createProjectEstimateHandler, validateProjectEstimate } = require("../src/controllers/projectEstimateController");

const validEstimate = {
    name: "Client Name",
    email: "client@example.com",
    phone: "+919876543210",
    services: ["Website Development", "UI/UX Design"],
    oneTimeTotal: 19598,
    monthlyTotal: 0
};

function createResponse() {
    return {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

test("project estimate validation requires client details and selected services", () => {
    assert.deepEqual(validateProjectEstimate(validEstimate), validEstimate);
    assert.equal(validateProjectEstimate({ ...validEstimate, phone: "98765" }), null);
    assert.equal(validateProjectEstimate({ ...validEstimate, services: [] }), null);
    assert.equal(validateProjectEstimate({ ...validEstimate, oneTimeTotal: -1 }), null);
});

test("project estimate emails service and contact details to the support inbox", async () => {
    let emailRequest;
    const handler = createProjectEstimateHandler({
        env: {
            RESEND_API_KEY: "test-key",
            RESEND_FROM_EMAIL: "JEXOLYT <estimates@example.com>",
            SUPPORT_INBOX_EMAIL: "support@example.com"
        },
        fetchImpl: async (url, options) => {
            emailRequest = { url, options };
            return { ok: true, status: 200 };
        }
    });
    const response = createResponse();

    await handler({ body: validEstimate }, response);

    assert.equal(response.statusCode, 202);
    assert.equal(emailRequest.url, "https://api.resend.com/emails");
    const email = JSON.parse(emailRequest.options.body);
    assert.deepEqual(email.to, ["support@example.com"]);
    assert.equal(email.reply_to, validEstimate.email);
    assert.match(email.text, /Name: Client Name/);
    assert.match(email.text, /Mobile: \+919876543210/);
    assert.match(email.text, /Website Development/);
    assert.match(email.text, /₹19,598/);
});

test("project estimate reports missing email configuration", async () => {
    const handler = createProjectEstimateHandler({ env: {} });
    const response = createResponse();

    await handler({ body: validEstimate }, response);

    assert.equal(response.statusCode, 503);
    assert.match(response.body.message, /not configured/i);
});

test("project estimate does not report success when email delivery fails", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
        const handler = createProjectEstimateHandler({
            env: {
                RESEND_API_KEY: "test-key",
                RESEND_FROM_EMAIL: "JEXOLYT <estimates@example.com>"
            },
            fetchImpl: async () => ({ ok: false, status: 422 })
        });
        const response = createResponse();

        await handler({ body: validEstimate }, response);

        assert.equal(response.statusCode, 502);
        assert.match(response.body.message, /could not be emailed/i);
    } finally {
        console.error = originalError;
    }
});
