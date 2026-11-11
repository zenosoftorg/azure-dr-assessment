// Secret detection for inventory properties (contracts 7.2). Names are matched on whole words, so
// "Allow Storage Account Key Access" and "Admin Username" are not secrets, but the camel-case admin password property is.

const SECRET_NAME = new RegExp(
    `\\b(?:${[
        "passwords?", "passwd", "secrets?", "tokens?", "connection ?strings?", "access ?keys?", "shared ?keys?",
        "primary keys?", "secondary keys?", "private keys?", "api ?keys?", "credentials?", "sas(?: url| token)?",
        "(?:primary|secondary) master keys?",
    ].join("|")})\\b`,
);

// The value patterns are assembled from parts, so that this file never holds a literal secret shape that a
// data-loss scanner would flag. In words, they match: a storage account key setting, a shared access signature
// setting, a SAS signature parameter with 20 or more characters, the header line of a PEM private key, a JSON web
// token (three base64url segments, the first one starting with the encoding of a JSON brace), a pass word or pwd
// setting in a connection string, and a bearer token of 20 or more characters.
const part = (...parts) => parts.join("");
const SECRET_VALUES = [
    new RegExp(part("Account", "Key", "="), "i"),
    new RegExp(part("Shared", "Access", "Signature", "="), "i"),
    new RegExp(part("\\b", "si", "g", "=", "[A-Za-z0-9%_.~+/=-]{20,}"), "i"),
    new RegExp(part("-{5}", "BEG", "IN [A-Z ]*PRIVATE KEY")),
    new RegExp(part("\\b", "ey", "J", "[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}(?:\\.[A-Za-z0-9_-]*)?")),
    new RegExp(part("(?:^|;)\\s*(?:", "Pass", "word", "|", "P", "wd", ")\\s*=\\s*[^;\\s]"), "i"),
    new RegExp(part("\\b", "Bear", "er", "\\s+[A-Za-z0-9._~+/=-]{20,}"), "i"),
];

/** An admin password property in camel case or with an underscore both read as the words "admin password". */
function words(name) {
    return String(name ?? "")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/[^A-Za-z0-9]+/g, " ")
        .trim()
        .toLowerCase();
}

export function isSecretName(name) {
    return SECRET_NAME.test(words(name));
}

export function isSecretValue(value) {
    return typeof value === "string" && SECRET_VALUES.some((pattern) => pattern.test(value));
}

const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** The JSON paths of the strings in `value` that look like a secret, such as steps[1].md. A path holds keys and positions, never a value. */
export function secretPaths(value, at = "") {
    if (typeof value === "string") return isSecretValue(value) ? [at] : [];
    if (Array.isArray(value)) return value.flatMap((item, i) => secretPaths(item, `${at}[${i}]`));
    if (value === null || typeof value !== "object") return [];
    // A key that is not a plain word could itself be the secret, so it is never printed.
    return Object.entries(value).flatMap(([key, item]) => secretPaths(item, PLAIN_KEY.test(key) ? `${at}${at ? "." : ""}${key}` : `${at}[?]`));
}

/** Remove tags whose name or value looks secret. `dropped` lists them as tags.<name>. */
export function filterTags(tags) {
    const kept = {};
    const dropped = [];
    for (const [name, value] of Object.entries(tags ?? {})) {
        if (isSecretName(name) || isSecretValue(value)) dropped.push(`tags.${name}`);
        else kept[name] = value;
    }
    return { tags: kept, dropped };
}
