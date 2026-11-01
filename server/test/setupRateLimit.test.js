const test = require("node:test");
const assert = require("node:assert/strict");
const { app } = require("../server");
const User = require("../src/models/user");

test("setup status checks do not consume Super Admin setup attempts", async t => {
    const originalExists = User.exists;
    User.exists = async () => null;
    const server = app.listen(0, "127.0.0.1");

    t.after(async () => {
        User.exists = originalExists;
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    });

    await new Promise(resolve => server.once("listening", resolve));
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;

    for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await fetch(`${origin}/api/auth/setup/status`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true, available: true });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await fetch(`${origin}/api/auth/setup`, {
            method: "POST",
            headers: {
                Origin: "https://jexolyt.web.app",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({})
        });
        assert.equal(response.status, 401);
    }

    const limitedResponse = await fetch(`${origin}/api/auth/setup`, {
        method: "POST",
        headers: {
            Origin: "https://jexolyt.web.app",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({})
    });
    assert.equal(limitedResponse.status, 429);
});
