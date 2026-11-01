const MODULES = [
    "dashboard",
    "users",
    "departments",
    "projects",
    "clients",
    "finance",
    "settings",
    "reports",
    "notifications",
    "activity-logs",
    "search",
    "data",
    "integrations",
    "support",
    "website"
];

const ACTIONS = ["view", "create", "edit", "delete"];
const RECORD_STATUSES = {
    departments: ["active", "inactive"],
    projects: ["planning", "active", "on-hold", "completed", "cancelled"],
    clients: ["active", "inactive", "potential"],
    finance: ["draft", "pending", "paid", "received", "refunded", "cancelled"],
    settings: ["active", "inactive"],
    reports: ["draft", "ready", "archived"],
    notifications: ["unread", "read"],
    integrations: ["connected", "not-configured", "error", "disabled"],
    support: ["open", "in-progress", "pending", "resolved", "closed"],
    website: ["draft", "published", "unpublished", "new", "read", "in-review"]
};
const DEFAULT_STATUS = {
    projects: "planning",
    clients: "potential",
    finance: "draft",
    reports: "draft",
    notifications: "unread",
    integrations: "not-configured",
    support: "open",
    website: "draft"
};

function hasPermission(user, module, action) {
    if (!MODULES.includes(module) || !ACTIONS.includes(action)) return false;
    if (user.role === "super_admin") return true;
    const modulePermissions = user.permissions instanceof Map
        ? user.permissions.get(module)
        : user.permissions?.[module];
    return modulePermissions?.[action] === true;
}

function cleanPermissions(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Permissions must be an object.");
    }

    const result = {};
    for (const [module, actions] of Object.entries(input)) {
        if (!MODULES.includes(module) || !actions || typeof actions !== "object" || Array.isArray(actions)) {
            throw new TypeError("Permissions contain an unsupported module.");
        }
        const cleaned = {};
        for (const [action, enabled] of Object.entries(actions)) {
            if (!ACTIONS.includes(action) || typeof enabled !== "boolean") {
                throw new TypeError("Permissions must use boolean view, create, edit, or delete values.");
            }
            cleaned[action] = enabled;
        }
        result[module] = cleaned;
    }
    return result;
}

function validateRecordInput(input, module) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Record data must be an object.");
    }
    const allowed = new Set(["title", "description", "status", "amount", "dueDate", "category", "transactionType", "url", "content", "metadata", "read"]);
    for (const key of Object.keys(input)) {
        if (!allowed.has(key)) throw new TypeError(`Unsupported record field: ${key}`);
    }
    if (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 160) {
        throw new TypeError("A title of 1–160 characters is required.");
    }
    if (input.description !== undefined && (typeof input.description !== "string" || input.description.length > 5000)) {
        throw new TypeError("Description must be a string of at most 5,000 characters.");
    }
    if (input.status !== undefined && (
        typeof input.status !== "string" ||
        input.status.length > 40 ||
        (RECORD_STATUSES[module] && !RECORD_STATUSES[module].includes(input.status))
    )) {
        throw new TypeError("Choose a supported status for this module.");
    }
    if (input.content !== undefined && (typeof input.content !== "string" || input.content.length > 10000)) {
        throw new TypeError("Content must be a string of at most 10,000 characters.");
    }
    if (input.category !== undefined && (typeof input.category !== "string" || input.category.length > 100)) {
        throw new TypeError("Category must be a string of at most 100 characters.");
    }
    if (input.transactionType !== undefined && !["income", "expense", "invoice", "payment", "payroll", "tax", "refund"].includes(input.transactionType)) {
        throw new TypeError("Choose a supported financial transaction type.");
    }
    if (input.amount !== undefined && (!Number.isFinite(Number(input.amount)) || Number(input.amount) < 0)) {
        throw new TypeError("Amount must be a non-negative number.");
    }
    if (module === "finance" && (input.amount === undefined || input.transactionType === undefined)) {
        throw new TypeError("Finance records require an amount and transaction type.");
    }
    if (input.dueDate !== undefined && input.dueDate !== "" && Number.isNaN(Date.parse(input.dueDate))) {
        throw new TypeError("Due date must be a valid date.");
    }
    if (input.url !== undefined) {
        if (typeof input.url !== "string" || input.url.length > 1000) {
            throw new TypeError("URL must be a string of at most 1,000 characters.");
        }
        if (!input.url.startsWith("#") && !input.url.startsWith("/") || input.url.startsWith("//")) {
            let url;
            try {
                url = new URL(input.url);
            } catch {
                throw new TypeError("URL must be a valid HTTP or HTTPS address.");
            }
            if (!["http:", "https:"].includes(url.protocol)) {
                throw new TypeError("Only HTTP and HTTPS URLs are allowed.");
            }
        }
    }
    if (input.read !== undefined && typeof input.read !== "boolean") {
        throw new TypeError("Read state must be a boolean.");
    }
    const metadata = input.metadata === undefined ? {} : input.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw new TypeError("Additional fields must be an object.");
    }
    if (Buffer.byteLength(JSON.stringify(metadata), "utf8") > 24000) {
        throw new TypeError("Additional fields must be smaller than 24 KB.");
    }
    if (/(secret|password|token|private.?key|api.?key)/i.test(JSON.stringify(metadata)) ||
        /(?:api[_ -]?key|client[_ -]?secret|password|access[_ -]?token|private[_ -]?key)\s*[:=]\s*\S+/i.test(JSON.stringify(input))) {
        throw new TypeError("Secrets and credentials cannot be stored in admin records.");
    }

    const data = {};
    for (const key of allowed) {
        if (key !== "title" && input[key] !== undefined) data[key] = input[key];
    }
    data.metadata = metadata;
    if (module === "website" && metadata.key === "homepage") {
        for (const [field, maxLength] of [["heroTitle", 160], ["heroDescription", 2000], ["buttonLabel", 60], ["buttonUrl", 1000]]) {
            if (metadata[field] !== undefined && (typeof metadata[field] !== "string" || metadata[field].length > maxLength)) {
                throw new TypeError(`Homepage ${field} must be a string of at most ${maxLength} characters.`);
            }
        }
        const buttonUrl = metadata.buttonUrl;
        if (buttonUrl && (!buttonUrl.startsWith("#") && !buttonUrl.startsWith("/") || buttonUrl.startsWith("//"))) {
            let parsed;
            try {
                parsed = new URL(buttonUrl);
            } catch {
                throw new TypeError("Homepage button URL must be a same-site path or HTTP(S) URL.");
            }
            if (!["http:", "https:"].includes(parsed.protocol)) {
                throw new TypeError("Homepage button URL must be a same-site path or HTTP(S) URL.");
            }
        }
    }
    return { title: input.title.trim(), status: input.status?.trim() || DEFAULT_STATUS[module] || "active", data };
}

module.exports = { MODULES, ACTIONS, hasPermission, cleanPermissions, validateRecordInput };
