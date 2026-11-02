const { applicationDefault, cert, getApps, initializeApp } = require("firebase-admin/app");

const APP_NAME = "jexolyt-admin-chat";
const PROJECT_ID = "govindkr-dev";

function getFirebaseProjectId(projectId = process.env.FIREBASE_PROJECT_ID) {
    const configuredProjectId = typeof projectId === "string" ? projectId.trim() : "";
    if (configuredProjectId && configuredProjectId !== PROJECT_ID) {
        throw new Error(`FIREBASE_PROJECT_ID must be ${PROJECT_ID}.`);
    }
    return PROJECT_ID;
}

function parseServiceAccountJson(value) {
    let serviceAccount;
    try {
        serviceAccount = JSON.parse(value);
    } catch {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.");
    }

    if (typeof serviceAccount.private_key === "string") {
        serviceAccount.private_key = serviceAccount.private_key
            .replace(/\r\n/g, "\n")
            .replace(/(?:\\r)?\\n/g, "\n")
            .trim();
    }
    return serviceAccount;
}

function getFirebaseAdminApp() {
    const projectId = getFirebaseProjectId();

    const existingApp = getApps().find(app => app.name === APP_NAME);
    if (existingApp) return existingApp;

    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        credential = cert(parseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
    } else {
        credential = applicationDefault();
    }

    return initializeApp({
        credential,
        projectId
    }, APP_NAME);
}

module.exports = { getFirebaseAdminApp, getFirebaseProjectId, parseServiceAccountJson };
