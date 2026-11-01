const test = require("node:test");
const assert = require("node:assert/strict");
const { createChatNotificationHandler, validateChatNotification } = require("../src/controllers/chatNotificationController");

const validBody = {
    chatSessionId: `guest_anonymous-user_${"a".repeat(48)}`,
    name: "Client Name",
    phone: "+919876543210",
    message: "Please help with my project."
};

function createMockFirestore() {
    let delivery = null;
    const chatRef = { kind: "chat", id: validBody.chatSessionId };
    const deliveryRef = { kind: "delivery", id: validBody.chatSessionId };
    const firstMessageQuery = { kind: "messages" };
    return {
        collection(name) {
            return {
                doc(id) {
                    if (name === "chats") {
                        return {
                            ...chatRef,
                            id,
                            collection: () => ({
                                orderBy: () => ({
                                    limit: () => firstMessageQuery
                                })
                            })
                        };
                    }
                    return { ...deliveryRef, id };
                }
            };
        },
        async runTransaction(callback) {
            return callback({
                async get(reference) {
                    if (reference.kind === "chat") {
                        return {
                            exists: true,
                            data: () => ({
                                members: ["anonymous-user"],
                                guestName: validBody.name,
                                guestPhone: validBody.phone
                            })
                        };
                    }
                    if (reference.kind === "delivery") {
                        return { exists: Boolean(delivery), data: () => delivery };
                    }
                    return {
                        docs: [{
                            data: () => ({
                                from: "anonymous-user",
                                senderType: "guest",
                                text: "First request from the client."
                            })
                        }]
                    };
                },
                set(reference, data) {
                    if (reference.kind === "delivery") delivery = { ...delivery, ...data };
                }
            });
        }
    };
}

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

function createRequest(body = validBody, authorization = "Bearer valid-token") {
    return {
        body,
        get(name) {
            return name.toLowerCase() === "authorization" ? authorization : undefined;
        }
    };
}

test("chat notification validation requires a normalized mobile number", () => {
    assert.deepEqual(validateChatNotification(validBody), {
        ...validBody,
        name: "Client Name"
    });
    assert.equal(validateChatNotification({ ...validBody, phone: "98765" }), null);
    assert.equal(validateChatNotification({ ...validBody, message: " " }), null);
});

test("chat notification requires a verified Firebase session", async () => {
    const handler = createChatNotificationHandler({
        verifyIdToken: async () => { throw Object.assign(new Error("invalid token"), { code: "auth/invalid-id-token" }); },
        env: {}
    });
    const response = createResponse();

    await handler(createRequest(), response);

    assert.equal(response.statusCode, 401);
    assert.match(response.body.message, /session could not be verified/i);
});

test("chat notification reports missing Firebase Admin server configuration", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
        const handler = createChatNotificationHandler({
            verifyIdToken: async () => { throw new Error("Firebase Admin is not configured."); },
            env: {}
        });
        const response = createResponse();

        await handler(createRequest(), response);

        assert.equal(response.statusCode, 503);
        assert.match(response.body.message, /verification service is not configured/i);
    } finally {
        console.error = originalError;
    }
});

test("chat notification reports missing server email configuration", async () => {
    const handler = createChatNotificationHandler({
        verifyIdToken: async () => ({ uid: "anonymous-user" }),
        getFirestore: createMockFirestore,
        env: {}
    });
    const response = createResponse();

    await handler(createRequest(), response);

    assert.equal(response.statusCode, 503);
    assert.match(response.body.message, /not configured/i);
});

test("chat notification emails the support inbox with the visitor's phone number", async () => {
    let emailRequest;
    const handler = createChatNotificationHandler({
        verifyIdToken: async token => {
            assert.equal(token, "valid-token");
            return { uid: "anonymous-user" };
        },
        getFirestore: createMockFirestore,
        env: {
            RESEND_API_KEY: "test-key",
            RESEND_FROM_EMAIL: "JEXOLYT <chat@example.com>",
        },
        fetchImpl: async (url, options) => {
            emailRequest = { url, options };
            return { ok: true, status: 200 };
        }
    });
    const response = createResponse();

    await handler(createRequest(), response);

    assert.equal(response.statusCode, 202);
    assert.equal(emailRequest.url, "https://api.resend.com/emails");
    assert.equal(emailRequest.options.headers.Authorization, "Bearer test-key");
    const email = JSON.parse(emailRequest.options.body);
    assert.equal(email.from, "JEXOLYT <chat@example.com>");
    assert.deepEqual(email.to, ["govindsh.dev@gmail.com"]);
    assert.equal(email.subject, "New JEXOLYT chat message from Client Name");
    assert.match(email.text, /Mobile: \+919876543210/);
    assert.match(email.text, /First request from the client\./);
});

test("chat notification reports provider failures without claiming email delivery", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
        const handler = createChatNotificationHandler({
            verifyIdToken: async () => ({ uid: "anonymous-user" }),
            getFirestore: createMockFirestore,
            env: {
                RESEND_API_KEY: "test-key",
                RESEND_FROM_EMAIL: "JEXOLYT <chat@example.com>"
            },
            fetchImpl: async () => ({ ok: false, status: 422 })
        });
        const response = createResponse();

        await handler(createRequest(), response);

        assert.equal(response.statusCode, 502);
        assert.match(response.body.message, /message was saved.*could not be delivered/i);
    } finally {
        console.error = originalError;
    }
});

test("chat notification only emails the first message once per conversation", async () => {
    const firestore = createMockFirestore();
    let emailCount = 0;
    const handler = createChatNotificationHandler({
        verifyIdToken: async () => ({ uid: "anonymous-user" }),
        getFirestore: () => firestore,
        env: {
            RESEND_API_KEY: "test-key",
            RESEND_FROM_EMAIL: "JEXOLYT <chat@example.com>"
        },
        fetchImpl: async () => {
            emailCount += 1;
            return { ok: true, status: 200 };
        }
    });

    const firstResponse = createResponse();
    await handler(createRequest(), firstResponse);
    const secondResponse = createResponse();
    await handler(createRequest({ ...validBody, message: "A later message." }), secondResponse);

    assert.equal(firstResponse.statusCode, 202);
    assert.equal(secondResponse.statusCode, 202);
    assert.equal(emailCount, 1);
});

test("chat notification rejects a Firebase user who does not own the chat ID", async () => {
    const handler = createChatNotificationHandler({
        verifyIdToken: async () => ({ uid: "different-user" }),
        getFirestore: createMockFirestore,
        env: {
            RESEND_API_KEY: "test-key",
            RESEND_FROM_EMAIL: "JEXOLYT <chat@example.com>"
        }
    });
    const response = createResponse();

    await handler(createRequest(), response);

    assert.equal(response.statusCode, 403);
});
