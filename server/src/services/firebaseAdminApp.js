const { applicationDefault, cert, getApps, initializeApp } = require("firebase-admin/app");

const APP_NAME = "jexolyt-admin-chat";

function getFirebaseAdminApp() {
    if (process.env.FIREBASE_PROJECT_ID !== "govindkr-dev") {
        throw new Error("FIREBASE_PROJECT_ID must be govindkr-dev.");
    }

    const existingApp = getApps().find(app => app.name === APP_NAME);
    if (existingApp) return existingApp;

    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        let serviceAccount;
        try {
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        } catch {
            throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.");
        }
        credential = cert(serviceAccount);
    } else {
        credential = applicationDefault();
    }

    return initializeApp({
        credential,
        projectId: process.env.FIREBASE_PROJECT_ID
    }, APP_NAME);
}

module.exports = { getFirebaseAdminApp };
