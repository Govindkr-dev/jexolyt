const CHAT_SESSION_PATTERN = /^guest_.+_[a-f\d]{48}$/i;
const PHONE_PATTERN = /^\+[1-9]\d{9,14}$/;
const NOTIFICATION_LEASE_MS = 60_000;
const DEFAULT_SUPPORT_INBOX = "govindsh.dev@gmail.com";

function validateChatNotification(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return null;
    }

    const { chatSessionId, name, phone, message } = body;
    if (
        typeof chatSessionId !== "string" || !CHAT_SESSION_PATTERN.test(chatSessionId) ||
        typeof name !== "string" || !name.trim() || name.trim().length > 100 ||
        typeof phone !== "string" || !PHONE_PATTERN.test(phone) ||
        typeof message !== "string" || !message.trim() || message.trim().length > 3000
    ) {
        return null;
    }

    return {
        chatSessionId,
        name: name.trim(),
        phone,
        message: message.trim()
    };
}

function createChatNotificationHandler({
    verifyIdToken,
    getFirestore,
    fetchImpl = globalThis.fetch,
    env = process.env
}) {
    return async function sendChatNotification(req, res) {
        const notification = validateChatNotification(req.body);
        if (!notification) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid name, mobile number, chat session, and message."
            });
        }

        const token = req.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
        if (!token || typeof verifyIdToken !== "function") {
            return res.status(401).json({ success: false, message: "A verified chat session is required." });
        }

        let decodedToken;
        try {
            decodedToken = await verifyIdToken(token);
        } catch (error) {
            if (error.code?.startsWith("auth/")) {
                return res.status(401).json({ success: false, message: "The chat session could not be verified." });
            }
            console.error("Chat session verification is unavailable:", error.name);
            return res.status(503).json({
                success: false,
                message: "The chat verification service is not configured on the server."
            });
        }

        if (
            typeof decodedToken?.uid !== "string" ||
            !notification.chatSessionId.startsWith(`guest_${decodedToken.uid}_`) ||
            typeof getFirestore !== "function"
        ) {
            return res.status(403).json({ success: false, message: "This chat session is not authorized." });
        }

        const { RESEND_API_KEY, RESEND_FROM_EMAIL } = env;
        const supportInbox = env.SUPPORT_INBOX_EMAIL || DEFAULT_SUPPORT_INBOX;
        if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
            return res.status(503).json({
                success: false,
                message: "Chat email notifications are not configured on the server."
            });
        }

        if (typeof fetchImpl !== "function") {
            return res.status(503).json({
                success: false,
                message: "The server email service is unavailable."
            });
        }

        let db;
        let notificationData;
        try {
            db = getFirestore();
            const chatRef = db.collection("chats").doc(notification.chatSessionId);
            const messagesQuery = chatRef.collection("messages")
                .orderBy("createdAt", "asc")
                .limit(1);
            const deliveryRef = db.collection("chatNotificationDeliveries").doc(notification.chatSessionId);
            const now = Date.now();

            notificationData = await db.runTransaction(async transaction => {
                const [chatSnapshot, deliverySnapshot, firstMessages] = await Promise.all([
                    transaction.get(chatRef),
                    transaction.get(deliveryRef),
                    transaction.get(messagesQuery)
                ]);
                if (!chatSnapshot.exists) return { error: "missing-chat" };

                const chat = chatSnapshot.data();
                if (
                    !Array.isArray(chat.members) ||
                    !chat.members.includes(decodedToken.uid) ||
                    chat.guestName !== notification.name ||
                    chat.guestPhone !== notification.phone
                ) {
                    return { error: "unauthorized-chat" };
                }

                const firstMessage = firstMessages.docs[0]?.data();
                if (
                    !firstMessage ||
                    firstMessage.from !== decodedToken.uid ||
                    firstMessage.senderType !== "guest"
                ) {
                    return { error: "missing-first-message" };
                }

                const delivery = deliverySnapshot.exists ? deliverySnapshot.data() : {};
                if (delivery.sentAt) return { alreadySent: true };
                if (Number(delivery.leaseUntil) > now) return { alreadySending: true };

                transaction.set(deliveryRef, {
                    uid: decodedToken.uid,
                    leaseUntil: now + NOTIFICATION_LEASE_MS
                }, { merge: true });

                return {
                    name: chat.guestName,
                    phone: chat.guestPhone,
                    message: String(firstMessage.text || "").trim().slice(0, 3000)
                };
            });
        } catch (error) {
            console.error("Could not verify the first client chat message:", error.name);
            return res.status(503).json({
                success: false,
                message: "The chat notification could not be verified."
            });
        }

        if (notificationData.error === "unauthorized-chat") {
            return res.status(403).json({ success: false, message: "This chat session is not authorized." });
        }
        if (notificationData.error === "missing-chat" || notificationData.error === "missing-first-message") {
            return res.status(409).json({ success: false, message: "The first chat message is not available yet." });
        }
        if (notificationData.alreadySent || notificationData.alreadySending) {
            return res.status(202).json({ success: true, message: "The first message has already been processed." });
        }

        const releaseNotificationLease = async sent => {
            const deliveryRef = db.collection("chatNotificationDeliveries").doc(notification.chatSessionId);
            await db.runTransaction(async transaction => {
                transaction.set(deliveryRef, {
                    leaseUntil: 0,
                    ...(sent ? { sentAt: Date.now() } : {})
                }, { merge: true });
            });
        };
        const lines = [
            "A new client sent their first message in JEXOLYT Project Chat.",
            "",
            `Name: ${notificationData.name}`,
            `Mobile: ${notificationData.phone}`,
            `Chat session: ${notification.chatSessionId}`,
            `Received: ${new Date().toISOString()}`,
            "",
            "First message:",
            notificationData.message
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
                    to: [supportInbox],
                    subject: `New JEXOLYT chat message from ${notificationData.name}`,
                    text: lines.join("\n")
                }),
                signal: AbortSignal.timeout(10_000)
            });

            if (!response.ok) {
                console.error("Chat notification provider rejected the email:", response.status);
                await releaseNotificationLease(false);
                return res.status(502).json({
                    success: false,
                    message: "The chat message was saved, but its email notification could not be delivered."
                });
            }

            await releaseNotificationLease(true);
            return res.status(202).json({ success: true, message: "Chat email notification sent." });
        } catch (error) {
            console.error("Chat notification email delivery failed:", error.name);
            try {
                await releaseNotificationLease(false);
            } catch (releaseError) {
                console.error("Could not release the chat notification lease:", releaseError.name);
            }
            return res.status(502).json({
                success: false,
                message: "The chat message was saved, but its email notification could not be delivered."
            });
        }
    };
}

module.exports = { createChatNotificationHandler, validateChatNotification };
