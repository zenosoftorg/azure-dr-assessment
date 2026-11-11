import assert from "node:assert/strict";
import test from "node:test";
import { filterTags, isSecretName, isSecretValue, secretPaths } from "../../skills/azure-dr-assessment/scripts/lib/secrets.mjs";
import { ACCOUNT_KEY, ADMIN_LOGIN_PASS_WORD, ADMIN_PASS_WORD, AUTHORIZATION, BEARER, fakeJwt, pemLine, SHARED_ACCESS_SIGNATURE, SIG } from "../helpers/secret-shapes.mjs";

const SECRET_NAMES = [
    "Password", "Admin Password", ADMIN_PASS_WORD, ADMIN_LOGIN_PASS_WORD, "passwd", "Passwords", "Secret", "Client Secret", "clientSecret",
    "Token", "tokens", "SAS Token", "sasToken", "SAS", "SAS URL", "sasUrl", "Connection String", "connectionString", "ConnectionString",
    "connectionstring", "Access Key", "accessKey", "AccessKey", "accesskey", "Shared Key", "sharedKey", "SharedKey", "Primary Key", "primaryKey",
    "Secondary Key", "Private Key", "privateKey", "API Key", "apiKey", "APIKey", "apikey", "Credential", "credentials", "storage_account_password",
    "PASSWORD",
];
const PLAIN_NAMES = [
    "Allow Storage Account Key Access", "Admin Username", "Secure Transfer Required", "Client Cert Enabled", "Microsoft Entra Authorization",
    "Name", "Subscription", "Resource Group", "Location", "Public Network Access", "Key Vault Name", "Soft Delete Retention (days)", "Tag Name",
    "Tag Value", "Sassy Setting", "Passage", "Tokenizer", "Access Tier", "Primary Location", "Secondary Location", "Zone Redundant",
    "Minimum TLS Version", "Keys Enabled", "Encryption", "Managed Identity",
];
const SECRET_VALUES = [
    `DefaultEndpointsProtocol=https;AccountName=a;${ACCOUNT_KEY}=abc123==`,
    `${ACCOUNT_KEY.toLowerCase()}=abc`,
    `${SHARED_ACCESS_SIGNATURE}=sv=2020-08-04&sr=b&${SIG}=abc`,
    `https://a.blob.core.windows.net/c?sv=2022-11-02&sp=r&${SIG}=Zm9vYmFyZm9vYmFyZm9vYmFy%2Bxyz%3D`,
    `${pemLine("BEGIN", "RSA PRIVATE KEY")}\nMIIEpAIBAAKCAQEA`,
    pemLine("BEGIN", "PRIVATE KEY"),
    pemLine("BEGIN", "ENCRYPTED PRIVATE KEY"),
    fakeJwt(),
    `${AUTHORIZATION}: ${BEARER} abcdefghijklmnopqrstuvwxyz0123`,
];
const PLAIN_VALUES = [
    "", "Standard_GRS", "westeurope", `${SIG}=short`, "design=abcdefghijklmnopqrstuvwxyz", pemLine("BEGIN", "CERTIFICATE"), `${BEARER} short`,
    "https://learn.microsoft.com/en-us/azure/reliability", "eyJ", "P1v3", 42, true, null, undefined, { [ACCOUNT_KEY]: "x" },
];

test("isSecretName matches the contract list in spaced, camelCase, joined and upper-case spellings", () => {
    for (const name of SECRET_NAMES) assert.equal(isSecretName(name), true, name);
});

test("isSecretName leaves ordinary settings alone, including the five names the contract protects", () => {
    for (const name of PLAIN_NAMES) assert.equal(isSecretName(name), false, name);
    assert.equal(isSecretName(null), false);
    assert.equal(isSecretName(undefined), false);
});

test("isSecretValue recognizes connection strings, SAS signatures, private keys and tokens", () => {
    for (const value of SECRET_VALUES) assert.equal(isSecretValue(value), true, value);
});

test("isSecretValue ignores ordinary strings and anything that is not a string", () => {
    for (const value of PLAIN_VALUES) assert.equal(isSecretValue(value), false, String(value));
});

test("filterTags drops secret-like names and values and reports their paths", () => {
    const { tags, dropped } = filterTags({ app: "checkout", "sas token": "x", note: `${ACCOUNT_KEY}=abc`, Env: "prod" });
    assert.deepEqual(tags, { app: "checkout", Env: "prod" });
    assert.deepEqual(dropped, ["tags.sas token", "tags.note"]);
    assert.deepEqual(filterTags({}), { tags: {}, dropped: [] });
});

// The secret-like values below are built at run time from parts, so that no file or tool output holds one.
const KEY_LIKE = `${ACCOUNT_KEY}=${"a".repeat(30)}`;
const SIG_LIKE = `https://tickets.example.com/browse/ARB-2026-114?${SIG}=${"q".repeat(24)}`;

test("secretPaths names the secret-like strings of a value by their keys and positions, at any depth", () => {
    const data = {
        title: "A story",
        steps: [{ md: "fine" }, { md: `reached with ${KEY_LIKE}` }],
        resolution: { documentedExceptions: [{ approval_ref: SIG_LIKE, ticket: "ARB-2026-114" }] },
        nested: { deeper: [[["x", KEY_LIKE]]] },
        mixed: [42, true, null, undefined, "plain"],
    };
    assert.deepEqual(secretPaths(data), ["steps[1].md", "resolution.documentedExceptions[0].approval_ref", "nested.deeper[0][0][1]"]);
});

test("secretPaths starts every path at the root it is given, and a bare string is the root itself", () => {
    assert.deepEqual(secretPaths(KEY_LIKE), [""]);
    assert.deepEqual(secretPaths(KEY_LIKE, "resolution"), ["resolution"]);
    assert.deepEqual(secretPaths([KEY_LIKE]), ["[0]"]);
    assert.deepEqual(secretPaths([[KEY_LIKE]]), ["[0][0]"]);
    assert.deepEqual(secretPaths([KEY_LIKE], "list"), ["list[0]"]);
    assert.deepEqual(secretPaths({ a: { b: KEY_LIKE } }, "resolution.documentedExceptions"), ["resolution.documentedExceptions.a.b"]);
});

test("secretPaths never prints a key that is not a plain word, because the key could itself be the secret", () => {
    const data = {
        [KEY_LIKE]: KEY_LIKE,
        "with space": [KEY_LIKE],
        "9lives": KEY_LIKE,
        "a.b": { c: KEY_LIKE },
        plain_key: KEY_LIKE,
        "kebab-key": KEY_LIKE,
        _hidden: KEY_LIKE,
    };
    const found = secretPaths(data, "resolution");
    assert.deepEqual(found, ["resolution[?]", "resolution[?][0]", "resolution[?]", "resolution[?].c", "resolution.plain_key", "resolution.kebab-key", "resolution._hidden"]);
    assert.equal(JSON.stringify(found).includes("Account"), false);
    assert.equal(JSON.stringify(found).includes("a".repeat(30)), false);
});

test("secretPaths finds nothing in ordinary text, and in values that are not text, arrays or objects", () => {
    const plain = [null, undefined, 42, true, "", "Standard_GRS", "https://tickets.example.com/browse/ARB-2026-114", [], {}, [1, [null, "westeurope"]], { a: { b: "P1v3" } }];
    for (const value of plain) assert.deepEqual(secretPaths(value), [], String(value));
});
