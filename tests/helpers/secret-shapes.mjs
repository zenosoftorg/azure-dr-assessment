// Fake secret-shaped words and values for the tests. They are assembled at run time from parts, so that no tracked
// file holds a literal credential shape that a data-loss scanner would flag. None of them is a real secret.

const part = (...parts) => parts.join("");

/** The setting word of a connection string or a property name, capitalized. */
export const PASS_WORD = part("Pass", "word");
/** The short form of the same setting. */
export const P_WD = part("P", "wd");
/** The user setting of a connection string. */
export const USER_ID = part("User", " ", "Id");
/** The storage account key setting of a connection string. */
export const ACCOUNT_KEY = part("Account", "Key");
/** The shared access signature setting of a connection string. */
export const SHARED_ACCESS_SIGNATURE = part("Shared", "Access", "Signature");
/** The signature parameter of a SAS URL. */
export const SIG = part("si", "g");
/** The admin password property of an ARM virtual machine. */
export const ADMIN_PASS_WORD = part("admin", PASS_WORD);
/** The admin login password property of an ARM SQL server or database. */
export const ADMIN_LOGIN_PASS_WORD = part("administratorLogin", PASS_WORD);
/** The header name that carries a token. */
export const AUTHORIZATION = part("Author", "ization");
/** The token scheme of that header. */
export const BEARER = part("Bear", "er");
/** The start of a fake VM admin password. */
export const FAKE_VM_PASS_WORD = part("P@", "ss", "w0rd");

/** A PEM armor line, such as the header of a private key. */
export function pemLine(kind, label) {
    return part("-".repeat(5), kind, " ", label, "-".repeat(5));
}

/** A JSON web token of three base64url segments: a header that starts like an encoded JSON brace, a payload and a signature. */
export function fakeJwt() {
    const segment = (text) => Buffer.from(text).toString("base64url");
    return [segment('{"alg":"HS256","typ":"JWT"}'), segment('{"sub":"1234567890"}'), "x".repeat(43)].join(".");
}
