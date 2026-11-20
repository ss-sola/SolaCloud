import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_LENGTH = 16;
const PASSWORD_ENCODING = 'hex';
const PASSWORD_SEPARATOR = ':';

/** PasswordUtil handles stateless password hashing and verification. */
export class PasswordUtil {
  static hash(password: string): string {
    const salt = randomBytes(PASSWORD_SALT_LENGTH).toString(PASSWORD_ENCODING);
    const hash = PasswordUtil.derive(password, salt);
    return [salt, hash].join(PASSWORD_SEPARATOR);
  }

  static verify(password: string, storedHash: string): boolean {
    const [salt, hash] = storedHash.split(PASSWORD_SEPARATOR);
    if (!salt || !hash) {
      return false;
    }
    const nextHash = PasswordUtil.derive(password, salt);
    const left = Buffer.from(hash, PASSWORD_ENCODING);
    const right = Buffer.from(nextHash, PASSWORD_ENCODING);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private static derive(password: string, salt: string): string {
    return scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString(PASSWORD_ENCODING);
  }
}
